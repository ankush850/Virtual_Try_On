import type { AnchorProfile, LandmarkResult, PoseFit, Vec2 } from '../types.js';

export type PoseFitterOptions = {
  scale: number;
  rotationZ: number;
  fingerIndex?: number | null;
  /** EMA alpha for position smoothing across frames. */
  positionAlpha?: number;
  /** EMA alpha for rotation smoothing. */
  rotationAlpha?: number;
  /** EMA alpha for scale smoothing. */
  scaleAlpha?: number;
};

type SpringState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/**
 * Phase 2 – Production PoseFitter.
 *
 * Enhancements:
 * - Spring-damped position smoothing (replaces simple EMA) for natural motion.
 * - Depth-aware scale from 3D keypoints when available.
 * - Multi-point rotation regression from eye/ear pair or finger direction.
 * - Anatomical rotation clamp per jewellery type.
 * - Ring-specific anchor respects fingerIndex.
 * - Bangle/wrist-rotation from WRIST_DIR + BANGLE_ROT vectors.
 * - Depth-hint output for Three.js z-positioning.
 * - Visibility hysteresis: fade out over a few frames rather than instant cut.
 */
export class PoseFitter {
  private smoothPos:    SpringState | null = null;
  private smoothSecPos: SpringState | null = null;
  private smoothRot    = 0;
  private smoothScale  = 0;
  private visibilityAlpha = 0; // 0 = invisible, 1 = fully visible

  private readonly positionAlpha: number;
  private readonly rotationAlpha: number;
  private readonly scaleAlpha: number;

  // Spring damping constants
  private readonly springStiffness = 0.35;
  private readonly springDamping   = 0.72;

  // Session fine-tune adjustments for edge cases (hair, collar, body variation)
  private fineTuneScaleMul = 1.0;
  private fineTuneOffsetY  = 0;

  constructor(
    private readonly profile: AnchorProfile,
    private readonly defaults: PoseFitterOptions,
  ) {
    this.positionAlpha = defaults.positionAlpha ?? 0.40;
    this.rotationAlpha = defaults.rotationAlpha ?? 0.25;
    this.scaleAlpha    = defaults.scaleAlpha    ?? 0.22;
  }

  setFineTune(scaleMultiplier = 1.0, offsetY = 0): void {
    this.fineTuneScaleMul = Math.max(0.5, Math.min(2.0, scaleMultiplier));
    this.fineTuneOffsetY  = offsetY;
  }

  fit(landmarks: LandmarkResult | null): PoseFit {
    const invisible: PoseFit = {
      position: this.smoothPos
        ? { x: this.smoothPos.x, y: this.smoothPos.y }
        : { x: 0, y: 0 },
      scale:     this.smoothScale || this.defaults.scale,
      rotationZ: this.smoothRot,
      confidence: 0,
      visible:   false,
    };

    if (!landmarks) {
      // Fade out visibility gradually
      this.visibilityAlpha = Math.max(0, this.visibilityAlpha - 0.15);
      if (this.visibilityAlpha > 0.05 && this.smoothPos) {
        return {
          ...invisible,
          visible: true,
          confidence: this.visibilityAlpha * 0.3,
        };
      }
      return invisible;
    }

    // If profile relies on shoulder/neck anchor and shoulders are not visible,
    // do not render jewellery in a misplaced location.
    if (
      landmarks.shouldersVisible === false &&
      (this.profile.primaryAnchor === 'NECK_BASE' ||
        this.profile.primaryAnchor === 'COLLARBONE' ||
        this.profile.primaryAnchor === 'NECKLACE_ANCHOR' ||
        this.profile.scaleRef === 'SHOULDER_WIDTH')
    ) {
      this.visibilityAlpha = 0;
      return invisible;
    }

    // ── Primary anchor selection ──────────────────────────────────────────
    let primaryKey = this.profile.primaryAnchor;
    if (this.defaults.fingerIndex != null && this.defaults.fingerIndex >= 0) {
      primaryKey = `RING_SLOT_${this.defaults.fingerIndex}`;
    }

    const primary = landmarks.named[primaryKey];
    if (!primary) {
      this.visibilityAlpha = Math.max(0, this.visibilityAlpha - 0.1);
      return invisible;
    }

    // Ramp up visibility
    this.visibilityAlpha = Math.min(1, this.visibilityAlpha + 0.25);

    // ── Secondary anchor ──────────────────────────────────────────────────
    const secondary = this.profile.secondaryAnchor
      ? landmarks.named[this.profile.secondaryAnchor]
      : undefined;

    // ── Scale computation ─────────────────────────────────────────────────
    const liveScale = landmarks.scaleRef || 100;
    const assetRef  = 100;
    let targetScale = this.defaults.scale * (liveScale / assetRef);

    // Depth-aware scale: if z-coordinates are available, adjust by relative depth.
    const primaryZ = (primary as { z?: number }).z;
    if (primaryZ != null && Number.isFinite(primaryZ)) {
      const refKey =
        landmarks.kind === 'face'
          ? 'NOSE_TIP'
          : landmarks.kind === 'pose'
            ? 'NECK_BASE'
            : 'WRIST';
      const refZ = (landmarks.named[refKey] as { z?: number } | undefined)?.z;
      if (refZ != null && Number.isFinite(refZ)) {
        const depthFactor = Math.max(0.6, Math.min(1.4, 1 + (refZ - primaryZ) * 0.008));
        targetScale *= depthFactor;
      }
    }

    const minS = this.profile.minScale ?? 0.2;
    const maxS = this.profile.maxScale ?? 3;
    targetScale = Math.min(maxS, Math.max(minS, targetScale * this.fineTuneScaleMul));

    // ── Offset ────────────────────────────────────────────────────────────
    const ox = (this.profile.offset?.x ?? 0) * liveScale;
    const oy = (this.profile.offset?.y ?? 0) * liveScale + this.fineTuneOffsetY;

    // ── Rotation ──────────────────────────────────────────────────────────
    let targetRotation = this.defaults.rotationZ;

    if (secondary) {
      targetRotation = Math.atan2(secondary.y - primary.y, secondary.x - primary.x);
    } else if (this.defaults.fingerIndex != null) {
      const rotKey  = `RING_ROT_${this.defaults.fingerIndex}`;
      const dirKey  = `FINGER_DIR_${this.defaults.fingerIndex}`;
      const rotPt   = landmarks.named[rotKey];
      const dirPt   = landmarks.named[dirKey];
      if (rotPt) {
        targetRotation = rotPt.x; // pre-computed angle stored in x
      } else if (dirPt) {
        targetRotation = Math.atan2(dirPt.y, dirPt.x);
      }
    } else if (landmarks.kind === 'pose') {
      const shoulderRot = landmarks.named['SHOULDER_ROT'];
      if (shoulderRot && Number.isFinite(shoulderRot.x)) {
        targetRotation = shoulderRot.x;
      }
    } else if (landmarks.kind === 'hand') {
      // Bangle/bracelet: prefer BANGLE_ROT, fallback to WRIST_DIR
      const bangleRot = landmarks.named['BANGLE_ROT'];
      const wristDir = landmarks.named['WRIST_DIR'];
      if (bangleRot) {
        targetRotation = bangleRot.x - Math.PI / 2;
      } else if (wristDir) {
        targetRotation = Math.atan2(wristDir.y, wristDir.x) - Math.PI / 2;
      }
    } else if (landmarks.kind === 'face') {
      const roll = landmarks.named['HEAD_ROLL'];
      if (roll && Number.isFinite(roll.x)) targetRotation = roll.x;
    }

    if (landmarks.kind === 'face') {
      const maxRot = (80 * Math.PI) / 180;
      targetRotation = Math.max(-maxRot, Math.min(maxRot, targetRotation));
    } else {
      if (targetRotation > Math.PI) targetRotation -= 2 * Math.PI;
      if (targetRotation < -Math.PI) targetRotation += 2 * Math.PI;
    }

    // ── Depth hint ────────────────────────────────────────────────────────
    let depthHint = 0;
    if (primaryZ != null && Number.isFinite(primaryZ)) {
      depthHint = primaryZ;
    }

    // ── Spring-damped position smoothing ──────────────────────────────────
    const rawPos = { x: primary.x + ox, y: primary.y + oy };

    if (!this.smoothPos) {
      this.smoothPos   = { x: rawPos.x, y: rawPos.y, vx: 0, vy: 0 };
      this.smoothRot   = targetRotation;
      this.smoothScale = targetScale;
    } else {
      // Spring physics for position
      const dx = rawPos.x - this.smoothPos.x;
      const dy = rawPos.y - this.smoothPos.y;

      const fx = dx * this.springStiffness;
      const fy = dy * this.springStiffness;

      this.smoothPos.vx = (this.smoothPos.vx + fx) * this.springDamping;
      this.smoothPos.vy = (this.smoothPos.vy + fy) * this.springDamping;

      this.smoothPos.x += this.smoothPos.vx;
      this.smoothPos.y += this.smoothPos.vy;

      // EMA for rotation and scale
      const ra = this.rotationAlpha;
      // Handle rotation wrapping at ±π
      let rotDiff = targetRotation - this.smoothRot;
      if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
      if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
      this.smoothRot += rotDiff * ra;

      const sa = this.scaleAlpha;
      this.smoothScale += (targetScale - this.smoothScale) * sa;
    }

    // Secondary spring smooth
    if (secondary) {
      const rawSec = { x: secondary.x - ox, y: secondary.y + oy };
      if (!this.smoothSecPos) {
        this.smoothSecPos = { x: rawSec.x, y: rawSec.y, vx: 0, vy: 0 };
      } else {
        const dx = rawSec.x - this.smoothSecPos.x;
        const dy = rawSec.y - this.smoothSecPos.y;
        const fx = dx * this.springStiffness;
        const fy = dy * this.springStiffness;
        this.smoothSecPos.vx = (this.smoothSecPos.vx + fx) * this.springDamping;
        this.smoothSecPos.vy = (this.smoothSecPos.vy + fy) * this.springDamping;
        this.smoothSecPos.x += this.smoothSecPos.vx;
        this.smoothSecPos.y += this.smoothSecPos.vy;
      }
    } else {
      this.smoothSecPos = null;
    }

    const yaw = landmarks.named['HEAD_YAW']?.x;
    const pitch = landmarks.named['HEAD_ROLL']?.y;

    return {
      position:          { x: this.smoothPos!.x, y: this.smoothPos!.y },
      secondaryPosition: this.smoothSecPos
        ? { x: this.smoothSecPos.x, y: this.smoothSecPos.y }
        : undefined,
      scale:             this.smoothScale,
      rotationZ:         this.smoothRot,
      confidence:        landmarks.confidence * this.visibilityAlpha,
      visible:           true,
      depthHint,
      yaw,
      pitch,
    };
  }

  reset(): void {
    this.smoothPos     = null;
    this.smoothSecPos  = null;
    this.smoothRot     = 0;
    this.smoothScale   = 0;
    this.visibilityAlpha = 0;
  }
}
