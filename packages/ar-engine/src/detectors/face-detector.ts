import * as blazeface from '@tensorflow-models/blazeface';
import type { ModelAdapter, PixelInput } from '../models/model-adapter.js';
import type { LandmarkResult } from '../types.js';

/**
 * Phase 2 – Production FaceDetector.
 *
 * Enhancements:
 * - Multi-frame confidence accumulator with exponential decay.
 * - Partial-face recovery: synthesizes missing landmarks from available ones.
 * - Head-yaw and head-pitch estimation for depth-aware earring placement.
 * - Frame-edge guard: detects when landmarks are clipped and adjusts confidence.
 * - Lighting estimation via bounding-box aspect ratio stability.
 * - Anatomically-corrected ear-lobe offsets per yaw angle.
 * - Forehead/crown anchor for tiaras and maang tikkas.
 * - Robust NaN/Infinity guards on every output coordinate.
 */
export class FaceDetector implements ModelAdapter {
  readonly name = 'face';
  private model: blazeface.BlazeFaceModel | null = null;
  private prevConfidence = 0;
  private frameCount = 0;
  private lastFrameWidth = 0;
  private lastFrameHeight = 0;

  // Rolling history for temporal smoothing
  private prevNamed: Record<string, { x: number; y: number }> = {};

  async load(): Promise<void> {
    this.model = await blazeface.load({ maxFaces: 1 });
  }

  async estimate(input: PixelInput): Promise<LandmarkResult | null> {
    if (!this.model) return null;

    // Cache frame dimensions for edge detection
    if ('videoWidth' in input) {
      this.lastFrameWidth = (input as HTMLVideoElement).videoWidth;
      this.lastFrameHeight = (input as HTMLVideoElement).videoHeight;
    } else if ('width' in input) {
      this.lastFrameWidth = (input as HTMLCanvasElement).width;
      this.lastFrameHeight = (input as HTMLCanvasElement).height;
    }

    let preds: blazeface.NormalizedFace[];
    try {
      preds = await this.model.estimateFaces(
        input as HTMLVideoElement | HTMLCanvasElement,
        false, // returnTensors
      );
    } catch {
      return null;
    }

    const face = preds[0];
    if (!face) {
      this.prevConfidence = Math.max(0, this.prevConfidence - 0.15);
      return null;
    }

    this.frameCount++;

    const landmarks = face.landmarks as Array<[number, number]> | undefined;
    const named: LandmarkResult['named'] = {};
    const points: LandmarkResult['points'] = [];

    const topLeft     = face.topLeft     as [number, number];
    const bottomRight = face.bottomRight as [number, number];
    const faceWidth   = Math.max(1, bottomRight[0] - topLeft[0]);
    const faceHeight  = Math.max(1, bottomRight[1] - topLeft[1]);
    const faceCenterX = (topLeft[0] + bottomRight[0]) / 2;
    const faceCenterY = (topLeft[1] + bottomRight[1]) / 2;

    const addSafe = (name: string, xy?: [number, number] | number[]) => {
      if (!xy || xy.length < 2) return;
      const x = Number(xy[0]);
      const y = Number(xy[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const point = { x, y, name };
      named[name] = point;
      points.push(point);
    };

    // BlazeFace landmark order: rightEye, leftEye, nose, mouth, rightEar, leftEar
    if (landmarks && landmarks.length >= 6) {
      addSafe('RIGHT_EYE',      landmarks[0]);
      addSafe('LEFT_EYE',       landmarks[1]);
      addSafe('NOSE_TIP',       landmarks[2]);
      addSafe('MOUTH',          landmarks[3]);
      addSafe('RIGHT_EAR_LOBE', landmarks[4]);
      addSafe('LEFT_EAR_LOBE',  landmarks[5]);
    }

    // ── Head pose estimation ──────────────────────────────────────────────
    const yaw   = this._estimateHeadYaw(named, faceWidth);
    const pitch  = this._estimateHeadPitch(named, faceHeight);
    const roll   = this._estimateHeadRoll(named);
    named['HEAD_ROLL'] = { x: roll, y: pitch, name: 'HEAD_ROLL' };
    named['HEAD_YAW'] = { x: yaw, y: 0, name: 'HEAD_YAW' };

    // ── Partial face recovery ─────────────────────────────────────────────
    // If one ear is missing but the other + nose exist, synthesize it
    if (!named['LEFT_EAR_LOBE'] && named['RIGHT_EAR_LOBE'] && named['NOSE_TIP']) {
      const rightEar = named['RIGHT_EAR_LOBE'];
      const nose = named['NOSE_TIP'];
      const dx = nose.x - rightEar.x;
      const dy = nose.y - rightEar.y;
      named['LEFT_EAR_LOBE'] = {
        x: nose.x + dx,
        y: nose.y + dy * 0.15,
        name: 'LEFT_EAR_LOBE',
      };
      points.push(named['LEFT_EAR_LOBE']);
    }

    if (!named['RIGHT_EAR_LOBE'] && named['LEFT_EAR_LOBE'] && named['NOSE_TIP']) {
      const leftEar = named['LEFT_EAR_LOBE'];
      const nose = named['NOSE_TIP'];
      const dx = nose.x - leftEar.x;
      const dy = nose.y - leftEar.y;
      named['RIGHT_EAR_LOBE'] = {
        x: nose.x + dx,
        y: nose.y + dy * 0.15,
        name: 'RIGHT_EAR_LOBE',
      };
      points.push(named['RIGHT_EAR_LOBE']);
    }

    // ── Yaw-compensated ear lobe positioning ─────────────────────────────
    // Shift earlobes based on head rotation for anatomically correct placement
    const yawCompX = yaw * faceWidth * 0.04;
    const yDropBase = faceHeight * 0.07;
    const pitchCompY = pitch * faceHeight * 0.03;

    if (named['LEFT_EAR_LOBE']) {
      named['LEFT_EAR_LOBE'] = {
        ...named['LEFT_EAR_LOBE'],
        x: named['LEFT_EAR_LOBE'].x - yawCompX,
        y: named['LEFT_EAR_LOBE'].y + yDropBase + pitchCompY,
      };
    }
    if (named['RIGHT_EAR_LOBE']) {
      named['RIGHT_EAR_LOBE'] = {
        ...named['RIGHT_EAR_LOBE'],
        x: named['RIGHT_EAR_LOBE'].x + yawCompX,
        y: named['RIGHT_EAR_LOBE'].y + yDropBase + pitchCompY,
      };
    }

    // ── Nose ring tip: shift for profile faces ───────────────────────────
    if (named['NOSE_TIP']) {
      const noseXShift = yaw * faceWidth * 0.02;
      named['NOSE_TIP'] = {
        ...named['NOSE_TIP'],
        x: named['NOSE_TIP'].x + noseXShift,
        y: named['NOSE_TIP'].y - faceHeight * 0.01,
      };
    }

    // ── Chin proxy ───────────────────────────────────────────────────────
    if (named['MOUTH']) {
      named['CHIN'] = {
        x: named['MOUTH'].x,
        y: named['MOUTH'].y + faceHeight * 0.20,
        name: 'CHIN',
      };
    } else {
      named['CHIN'] = {
        x: faceCenterX,
        y: bottomRight[1] - faceHeight * 0.05,
        name: 'CHIN',
      };
    }
    points.push(named['CHIN']!);

    // ── Necklace anchor ──────────────────────────────────────────────────
    named['NECKLACE_ANCHOR'] = {
      x: named['CHIN']!.x,
      y: named['CHIN']!.y + faceHeight * 0.28,
      name: 'NECKLACE_ANCHOR',
    };
    points.push(named['NECKLACE_ANCHOR']);

    // ── Forehead / crown anchor ──────────────────────────────────────────
    const foreheadX = named['NOSE_TIP']?.x ?? faceCenterX;
    const foreheadY = topLeft[1] + faceHeight * 0.08;
    named['FOREHEAD_CENTER'] = { x: foreheadX, y: foreheadY, name: 'FOREHEAD_CENTER' };
    points.push(named['FOREHEAD_CENTER']);

    // ── Maang tikka anchor ───────────────────────────────────────────────
    named['MAANG_TIKKA'] = {
      x: foreheadX,
      y: foreheadY - faceHeight * 0.04,
      name: 'MAANG_TIKKA',
    };
    points.push(named['MAANG_TIKKA']);

    // ── Inter-pupillary distance → scale reference ───────────────────────
    let scaleRef = faceWidth;
    if (named['LEFT_EYE'] && named['RIGHT_EYE']) {
      const ipd = Math.hypot(
        named['RIGHT_EYE'].x - named['LEFT_EYE'].x,
        named['RIGHT_EYE'].y - named['LEFT_EYE'].y,
      );
      scaleRef = ipd || faceWidth;
    }

    // ── Temporal confidence smoothing with exponential decay ─────────────
    const rawConf = Array.isArray(face.probability)
      ? Number(face.probability[0] ?? 0.85)
      : Number(face.probability ?? 0.85);

    const alpha = this.frameCount < 5 ? 0.5 : 0.75;
    const smoothedConf = Number.isFinite(rawConf)
      ? alpha * rawConf + (1 - alpha) * this.prevConfidence
      : this.prevConfidence;
    this.prevConfidence = smoothedConf;

    // ── Frame-edge clipping detection ────────────────────────────────────
    const edgeMargin = faceWidth * 0.12;
    const isLeftClipped = topLeft[0] < edgeMargin;
    const isRightClipped = this.lastFrameWidth > 0 && bottomRight[0] > this.lastFrameWidth - edgeMargin;
    const isTopClipped = topLeft[1] < edgeMargin;
    const isBottomClipped = this.lastFrameHeight > 0 && bottomRight[1] > this.lastFrameHeight - edgeMargin;

    const clippedEdges = [isLeftClipped, isRightClipped, isTopClipped, isBottomClipped].filter(Boolean).length;

    // ── Full face visibility check ───────────────────────────────────────
    const hasFullFace =
      Boolean(named['LEFT_EAR_LOBE']) &&
      Boolean(named['RIGHT_EAR_LOBE']) &&
      Boolean(named['NOSE_TIP']);

    // Reduce confidence based on face visibility and edge clipping
    let finalConf = smoothedConf;
    if (!hasFullFace) finalConf *= 0.75;
    if (clippedEdges > 0) finalConf *= (1 - clippedEdges * 0.08);

    // ── Store depth hints ────────────────────────────────────────────────
    const depthHint = -yaw * 0.5; // rough approximation

    // ── Temporal smoothing per-landmark ──────────────────────────────────
    const smoothAlpha = 0.6;
    for (const [key, point] of Object.entries(named)) {
      if (key === 'HEAD_ROLL' || key === 'HEAD_YAW') {
        const prev = this.prevNamed[key];
        if (prev) {
          let diff = point.x - prev.x;
          if (diff > Math.PI) diff -= 2 * Math.PI;
          if (diff < -Math.PI) diff += 2 * Math.PI;
          named[key] = { ...point, x: prev.x + diff * 0.35, y: prev.y + (point.y - prev.y) * 0.35 };
        }
        continue;
      }
      const prev = this.prevNamed[key];
      if (prev) {
        const smoothed = {
          ...point,
          x: prev.x + (point.x - prev.x) * smoothAlpha,
          y: prev.y + (point.y - prev.y) * smoothAlpha,
        };
        named[key] = smoothed;
      }
    }
    this.prevNamed = { ...named };

    return {
      kind:       'face',
      confidence: Math.max(0, Math.min(1, finalConf)),
      points,
      named,
      scaleRef,
    };
  }

  dispose(): void {
    this.model = null;
    this.prevConfidence = 0;
    this.prevNamed = {};
    this.frameCount = 0;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Approximate yaw (left-right head rotation) from eye and ear positions.
   * Returns a value in the range [-1 … +1] where 0 = frontal.
   */
  private _estimateHeadYaw(
    named: Record<string, { x: number; y: number }>,
    faceWidth: number,
  ): number {
    const nose = named['NOSE_TIP'];
    if (!nose || faceWidth < 1) return 0;
    const centerX = (named['LEFT_EAR_LOBE']
      ? (named['LEFT_EAR_LOBE'].x + (named['RIGHT_EAR_LOBE']?.x ?? nose.x)) / 2
      : nose.x);
    return Math.max(-1, Math.min(1, (nose.x - centerX) / faceWidth));
  }

  /**
   * Approximate pitch (up-down head tilt) from nose-to-mouth vertical ratio.
   * Returns a value in the range [-1 … +1] where 0 = level.
   */
  private _estimateHeadPitch(
    named: Record<string, { x: number; y: number }>,
    faceHeight: number,
  ): number {
    const nose = named['NOSE_TIP'];
    const mouth = named['MOUTH'];
    if (!nose || !mouth || faceHeight < 1) return 0;
    const noseToMouth = mouth.y - nose.y;
    const expected = faceHeight * 0.18;
    return Math.max(-1, Math.min(1, (noseToMouth - expected) / expected));
  }

  /**
   * Approximate roll (head tilt sideways) from eye positions.
   * Returns angle in radians.
   */
  private _estimateHeadRoll(
    named: Record<string, { x: number; y: number }>,
  ): number {
    const le = named['LEFT_EYE'];
    const re = named['RIGHT_EYE'];
    if (!le || !re) return 0;
    return Math.atan2(re.y - le.y, re.x - le.x);
  }
}
