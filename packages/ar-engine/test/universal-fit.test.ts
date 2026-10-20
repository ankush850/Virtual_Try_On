import { describe, it, expect, beforeEach } from 'vitest';
import { BodyModelEstimator } from '../src/landmarks/body-model-estimator.js';
import { PoseFitter } from '../src/fitting/pose-fitter.js';
import { AnchorRegistry } from '../src/anchors/anchor-registry.js';
import type { LandmarkResult } from '../src/types.js';

describe('SECTION 4: Universal Fit Engine Enhancements', () => {
  describe('Universal BodyModelEstimator Biometric Proportions', () => {
    let estimator: BodyModelEstimator;

    beforeEach(() => {
      estimator = new BodyModelEstimator(0.5); // alpha = 0.5 for fast test convergence
    });

    it('estimates and smooths face proportions (IPD, ear distance, face height)', () => {
      const faceLandmarks: LandmarkResult = {
        kind: 'face',
        confidence: 0.95,
        points: [],
        named: {
          LEFT_EYE: { x: 280, y: 150, name: 'LEFT_EYE' },
          RIGHT_EYE: { x: 360, y: 150, name: 'RIGHT_EYE' },
          LEFT_EAR_LOBE: { x: 230, y: 180, name: 'LEFT_EAR_LOBE' },
          RIGHT_EAR_LOBE: { x: 410, y: 180, name: 'RIGHT_EAR_LOBE' },
          FOREHEAD_CENTER: { x: 320, y: 90, name: 'FOREHEAD_CENTER' },
          CHIN: { x: 320, y: 260, name: 'CHIN' },
        },
      };

      const m = estimator.estimate(faceLandmarks);
      // Measured IPD is 360 - 280 = 80px (smoothed from 64)
      expect(m.interpupillaryDistance).toBeCloseTo(72, 1);
      // Ear distance is 410 - 230 = 180px (smoothed from 135)
      expect(m.earDistance).toBeCloseTo(157.5, 1);
      // Face height is 260 - 90 = 170px (smoothed from 180)
      expect(m.faceHeight).toBeCloseTo(175, 1);
    });

    it('estimates shoulder width and neck length from pose landmarks', () => {
      const poseLandmarks: LandmarkResult = {
        kind: 'pose',
        confidence: 0.92,
        points: [],
        named: {
          LEFT_SHOULDER: { x: 180, y: 320, name: 'LEFT_SHOULDER' },
          RIGHT_SHOULDER: { x: 460, y: 320, name: 'RIGHT_SHOULDER' },
          CHIN: { x: 320, y: 220, name: 'CHIN' },
          NECK_BASE: { x: 320, y: 310, name: 'NECK_BASE' },
        },
      };

      const m = estimator.estimate(poseLandmarks);
      // Shoulder width: 460 - 180 = 280px (smoothed from 320)
      expect(m.shoulderWidth).toBeCloseTo(300, 1);
      // Neck length: 310 - 220 = 90px (smoothed from 85)
      expect(m.neckLength).toBeCloseTo(87.5, 1);
    });

    it('estimates wrist width and finger width from hand landmarks', () => {
      const handLandmarks: LandmarkResult = {
        kind: 'hand',
        confidence: 0.90,
        points: [],
        named: {
          WRIST: { x: 300, y: 400, name: 'WRIST' },
          BANGLE_ANCHOR: { x: 335, y: 400, name: 'BANGLE_ANCHOR' },
          RING_SLOT_1: { x: 290, y: 250, name: 'RING_SLOT_1' },
          RING_SLOT_2: { x: 315, y: 250, name: 'RING_SLOT_2' },
        },
      };

      const m = estimator.estimate(handLandmarks);
      // Wrist width is ~ 35 * 2 = 70px (smoothed from 60)
      expect(m.wristWidth).toBeCloseTo(65, 1);
      // Finger width is 25px (smoothed from 20)
      expect(m.fingerWidth).toBeCloseTo(22.5, 1);
    });
  });

  describe('PoseFitter Session Fine-Tuning', () => {
    it('applies scale multiplier and vertical position offset dynamically', () => {
      const profile = AnchorRegistry.get('NECKLACE').defaultProfile;
      const fitter = new PoseFitter(profile, { scale: 1.0, rotationZ: 0 });

      const landmarks: LandmarkResult = {
        kind: 'pose',
        confidence: 0.95,
        points: [],
        named: {
          NECK_BASE: { x: 320, y: 260, name: 'NECK_BASE' },
          COLLARBONE: { x: 320, y: 280, name: 'COLLARBONE' },
          LEFT_SHOULDER: { x: 200, y: 280, name: 'LEFT_SHOULDER' },
          RIGHT_SHOULDER: { x: 440, y: 280, name: 'RIGHT_SHOULDER' },
        },
      };

      // Baseline fit
      const basePose = fitter.fit(landmarks);
      expect(basePose.visible).toBe(true);

      // Apply session fine-tune: 1.15x scale, +15px downward vertical shift
      fitter.setFineTune(1.15, 15);
      const tunedPose = fitter.fit(landmarks);

      expect(tunedPose.scale).toBeGreaterThan(basePose.scale);
      expect(tunedPose.position.y).toBeGreaterThan(basePose.position.y);
    });
  });
});
