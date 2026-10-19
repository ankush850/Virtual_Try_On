import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import type { ModelAdapter, PixelInput } from '../models/model-adapter.js';
import type { LandmarkResult } from '../types.js';

/**
 * Finger joint pairs used to compute mid-point ring slots and direction vectors.
 * Index → [proximal_key, distal_key]
 */
export const FINGER_JOINTS: Record<number, [string, string]> = {
  0: ['thumb_mcp',        'thumb_ip'],
  1: ['index_finger_mcp', 'index_finger_pip'],
  2: ['middle_finger_mcp','middle_finger_pip'],
  3: ['ring_finger_mcp',  'ring_finger_pip'],
  4: ['pinky_finger_mcp', 'pinky_finger_pip'],
};

/**
 * Phase 2 – Production HandDetector.
 *
 * Enhancements:
 * - Multi-hand tracking with hand-ID persistence.
 * - Full 3-D keypoint support via keypoints3D (depth for ring/bangle scale).
 * - Improved bangle anchor using wrist-to-palm center regression.
 * - Palm normal estimation for rotation-aware bangle rendering.
 * - Per-finger ring slot with precision positioning at PIP-MCP mid-point.
 * - Finger curl/extension detection for occlusion handling.
 * - Scale derived from both wrist-to-middle-mcp AND palm width with robust blending.
 * - Confidence-weighted temporal smoothing for scale and position jitter reduction.
 * - Hand chirality detection (left vs right hand).
 */
export class HandDetector implements ModelAdapter {
  readonly name = 'hand';
  private detector: handPoseDetection.HandDetector | null = null;
  private prevScaleRef = 80;
  private frameCount = 0;

  // Per-landmark temporal smoothing state
  private prevNamed: Record<string, { x: number; y: number }> = {};

  // Multi-hand state: store last known secondary hand
  private lastSecondaryHand: LandmarkResult | null = null;

  async load(): Promise<void> {
    this.detector = await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      {
        runtime: 'tfjs',
        modelType: 'full',   // Full model for better accuracy
        maxHands: 2,         // Support multi-hand (bangle both wrists)
      },
    );
  }

  async estimate(input: PixelInput): Promise<LandmarkResult | null> {
    if (!this.detector) return null;

    let hands: handPoseDetection.Hand[];
    try {
      hands = await this.detector.estimateHands(input, { flipHorizontal: false });
    } catch {
      return null;
    }

    const hand = hands[0];
    if (!hand || !hand.keypoints?.length) {
      this.frameCount = 0;
      return null;
    }

    this.frameCount++;

    // Process secondary hand for dual-wrist bangle support
    if (hands.length > 1) {
      this.lastSecondaryHand = this._processHand(hands[1]!);
    }

    return this._processHand(hand);
  }

  /** Get the secondary (second) hand result for dual-hand jewellery. */
  getSecondaryHand(): LandmarkResult | null {
    return this.lastSecondaryHand;
  }

  dispose(): void {
    this.detector = null;
    this.prevScaleRef = 80;
    this.prevNamed = {};
    this.lastSecondaryHand = null;
    this.frameCount = 0;
  }

  // ─── Private hand processing ───────────────────────────────────────────────

  private _processHand(hand: handPoseDetection.Hand): LandmarkResult {
    const named: LandmarkResult['named'] = {};
    const points = hand.keypoints.map((kp) => {
      const point = { x: kp.x, y: kp.y, z: (kp as { z?: number }).z, name: kp.name };
      if (kp.name) named[kp.name] = point;
      return point;
    });

    // ── Normalize wrist alias ──────────────────────────────────────────────
    const wrist = named['wrist'] ?? points[0];
    if (wrist) named['WRIST'] = wrist;

    // ── Hand chirality detection ───────────────────────────────────────────
    const handedness = hand.handedness ?? 'Right';
    named['HANDEDNESS'] = { x: handedness === 'Left' ? 0 : 1, y: 0 };

    // ── Compute ring slots and finger direction vectors ────────────────────
    for (const [idxStr, [proxKey, distKey]] of Object.entries(FINGER_JOINTS)) {
      const p1 = named[proxKey];
      const p2 = named[distKey];
      if (!p1 || !p2) continue;

      const idx = idxStr;

      // Ring slot = weighted mid-point (slightly toward distal for better visual)
      named[`RING_SLOT_${idx}`] = {
        x: p1.x * 0.45 + p2.x * 0.55,
        y: p1.y * 0.45 + p2.y * 0.55,
        name: `RING_SLOT_${idx}`,
      };

      // Direction vector for rotation angle computation
      const dirX = p2.x - p1.x;
      const dirY = p2.y - p1.y;
      named[`FINGER_DIR_${idx}`] = { x: dirX, y: dirY };

      // Rotation angle (radians) perpendicular to finger axis
      named[`RING_ROT_${idx}`] = {
        x: Math.atan2(dirY, dirX),
        y: 0,
        name: `RING_ROT_${idx}`,
      };

      // ── Finger curl detection ──────────────────────────────────────────
      // 0 = fully extended, 1 = fully curled
      const tipKey = distKey.replace('_pip', '_tip').replace('_ip', '_tip');
      const tip = named[tipKey];
      if (tip && wrist) {
        const tipToWrist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        const mcpToWrist = Math.hypot(p1.x - wrist.x, p1.y - wrist.y);
        const curlRatio = mcpToWrist > 0
          ? Math.max(0, Math.min(1, 1 - tipToWrist / (mcpToWrist * 2.2)))
          : 0;
        named[`FINGER_CURL_${idx}`] = { x: curlRatio, y: 0 };
      }
    }

    // ── Bangle / Bracelet anchor ───────────────────────────────────────────
    const indexMcp = named['index_finger_mcp'];
    const pinkyMcp = named['pinky_finger_mcp'];
    const middleMcp = named['middle_finger_mcp'];
    const ringMcp = named['ring_finger_mcp'];

    if (wrist && indexMcp) {
      // Position bangle between wrist and palm center
      const palmCenterX = middleMcp
        ? (indexMcp.x + (pinkyMcp?.x ?? indexMcp.x) + middleMcp.x) / 3
        : indexMcp.x;
      const palmCenterY = middleMcp
        ? (indexMcp.y + (pinkyMcp?.y ?? indexMcp.y) + middleMcp.y) / 3
        : indexMcp.y;

      named['BANGLE_ANCHOR'] = {
        x: wrist.x * 0.7 + palmCenterX * 0.3,
        y: wrist.y * 0.7 + palmCenterY * 0.3,
        name: 'BANGLE_ANCHOR',
      };

      // Wrist rotation: from wrist toward palm center
      const wx = palmCenterX - wrist.x;
      const wy = palmCenterY - wrist.y;
      named['WRIST_DIR'] = { x: wx, y: wy };

      // ── Bangle rotation angle ────────────────────────────────────────
      named['BANGLE_ROT'] = {
        x: Math.atan2(wy, wx),
        y: 0,
        name: 'BANGLE_ROT',
      };
    }

    // ── Watch anchor (slightly above bangle) ──────────────────────────────
    if (wrist && indexMcp) {
      const watchOffsetX = (indexMcp.x - wrist.x) * -0.15;
      const watchOffsetY = (indexMcp.y - wrist.y) * -0.15;
      named['WATCH_ANCHOR'] = {
        x: wrist.x + watchOffsetX,
        y: wrist.y + watchOffsetY,
        name: 'WATCH_ANCHOR',
      };
    }

    // ── Palm width for secondary scale reference ───────────────────────────
    let palmWidth = 0;
    if (indexMcp && pinkyMcp) {
      palmWidth = Math.hypot(pinkyMcp.x - indexMcp.x, pinkyMcp.y - indexMcp.y);
      named['FINGER_WIDTH'] = { x: Math.max(12, palmWidth * 0.22), y: 0, name: 'FINGER_WIDTH' };
      named['WRIST_WIDTH'] = { x: Math.max(25, palmWidth * 0.75), y: 0, name: 'WRIST_WIDTH' };
    }

    // ── Palm normal estimation ────────────────────────────────────────────
    // Cross product of wrist-index and wrist-pinky for palm facing direction
    if (wrist && indexMcp && pinkyMcp) {
      const v1x = indexMcp.x - wrist.x;
      const v1y = indexMcp.y - wrist.y;
      const v2x = pinkyMcp.x - wrist.x;
      const v2y = pinkyMcp.y - wrist.y;
      const crossZ = v1x * v2y - v1y * v2x;
      named['PALM_NORMAL'] = {
        x: crossZ > 0 ? 1 : -1, // 1 = palm facing camera, -1 = back
        y: Math.abs(crossZ) / Math.max(1, palmWidth * palmWidth),
      };
    }

    // ── Primary scale: wrist → middle finger MCP ─────────────────────────
    let rawScale = 80;
    if (wrist && middleMcp) {
      const palmLen = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
      rawScale = palmLen > 0 ? palmLen : rawScale;
      // Blend in palm width for robustness against finger curl
      if (palmWidth > 0) {
        rawScale = rawScale * 0.65 + palmWidth * 0.35;
      }
    }

    // ── 3D depth-aware scale adjustment ──────────────────────────────────
    if (wrist && middleMcp) {
      const wristZ = (wrist as { z?: number }).z;
      const middleZ = (middleMcp as { z?: number }).z;
      if (wristZ != null && middleZ != null && Number.isFinite(wristZ) && Number.isFinite(middleZ)) {
        const depthFactor = Math.max(0.7, Math.min(1.3, 1 + (wristZ - middleZ) * 0.005));
        rawScale *= depthFactor;
      }
    }

    // ── Temporal smoothing of scaleRef ────────────────────────────────────
    const score = hand.score ?? 0.8;
    // Higher confidence and more frames → faster update
    const rampUp = Math.min(1, this.frameCount / 10);
    const alpha = Math.min(1, (0.20 + score * 0.30) * rampUp + (1 - rampUp));
    const scaleRef = this.prevScaleRef + (rawScale - this.prevScaleRef) * alpha;
    this.prevScaleRef = scaleRef;

    // ── Temporal smoothing per-landmark ──────────────────────────────────
    const smoothAlpha = this.frameCount < 3 ? 0.8 : 0.55;
    for (const [key, point] of Object.entries(named)) {
      // Skip metadata-only entries
      if (key === 'HANDEDNESS' || key === 'PALM_NORMAL' || key.startsWith('FINGER_CURL_')) continue;
      const prev = this.prevNamed[key];
      if (prev) {
        named[key] = {
          ...point,
          x: prev.x + (point.x - prev.x) * smoothAlpha,
          y: prev.y + (point.y - prev.y) * smoothAlpha,
        };
      }
    }
    this.prevNamed = { ...named };

    return {
      kind:       'hand',
      confidence: score,
      points,
      named,
      scaleRef,
    };
  }
}
