import { describe, it, expect } from 'vitest';
import { JewelleryKind } from '@vj/shared';
import { AnchorRegistry } from '../src/anchors/anchor-registry.js';
import { detectorForKind } from '../src/ar-engine.js';
import { PoseDetector } from '../src/detectors/pose-detector.js';
import { FaceDetector } from '../src/detectors/face-detector.js';
import { PoseFitter } from '../src/fitting/pose-fitter.js';
import type { LandmarkResult } from '../src/types.js';

describe('MediaPipe Multi-Category Tracking Pipeline (Issue 7)', () => {
  describe('AnchorRegistry & Detector Routing', () => {
    it('routes NECKLACE to pose detector anchored at NECK_BASE (not CHIN)', () => {
      const reg = AnchorRegistry.get(JewelleryKind.NECKLACE);
      expect(reg.detector).toBe('pose');
      expect(reg.defaultProfile.primaryAnchor).toBe('NECK_BASE');
      expect(reg.defaultProfile.primaryAnchor).not.toBe('CHIN');
      expect(reg.defaultProfile.scaleRef).toBe('SHOULDER_WIDTH');

      expect(detectorForKind(JewelleryKind.NECKLACE)).toBe('pose');
    });

    it('routes NOSE_RING to face detector anchored at LEFT_NOSE_WING with real nostril width', () => {
      const reg = AnchorRegistry.get(JewelleryKind.NOSE_RING);
      expect(reg.detector).toBe('face');
      expect(reg.defaultProfile.primaryAnchor).toBe('LEFT_NOSE_WING');
      expect(reg.defaultProfile.scaleRef).toBe('NOSE_WING_WIDTH');

      expect(detectorForKind(JewelleryKind.NOSE_RING)).toBe('face');
    });

    it('routes EARRINGS to face detector with earlobe anchors and IPD/face width scale', () => {
      const reg = AnchorRegistry.get(JewelleryKind.EARRINGS);
      expect(reg.detector).toBe('face');
      expect(reg.defaultProfile.primaryAnchor).toBe('LEFT_EAR_LOBE');
      expect(reg.defaultProfile.secondaryAnchor).toBe('RIGHT_EAR_LOBE');

      expect(detectorForKind(JewelleryKind.EARRINGS)).toBe('face');
    });

    it('routes RINGS and BANGLES to hand detector with knuckle and wrist anchors', () => {
      const ringReg = AnchorRegistry.get(JewelleryKind.RINGS);
      expect(ringReg.detector).toBe('hand');
      expect(ringReg.defaultProfile.primaryAnchor).toBe('RING_SLOT_3');

      const bangleReg = AnchorRegistry.get(JewelleryKind.BANGLES);
      expect(bangleReg.detector).toBe('hand');
      expect(bangleReg.defaultProfile.primaryAnchor).toBe('BANGLE_ANCHOR');

      expect(detectorForKind(JewelleryKind.RINGS)).toBe('hand');
      expect(detectorForKind(JewelleryKind.BANGLES)).toBe('hand');
    });
  });

  describe('PoseDetector Anatomical Landmarks', () => {
    it('estimates real neck base and collarbone anchors from shoulder keypoints', async () => {
      const detector = new PoseDetector();
      await detector.load();

      // Simulated video input dimensions
      const mockInput = { width: 1280, height: 720 } as HTMLCanvasElement;
      const res = await detector.estimate(mockInput);

      expect(res).not.toBeNull();
      expect(res?.kind).toBe('pose');
      expect(res?.named['NECK_BASE']).toBeDefined();
      expect(res?.named['COLLARBONE']).toBeDefined();
      expect(res?.named['LEFT_SHOULDER']).toBeDefined();
      expect(res?.named['RIGHT_SHOULDER']).toBeDefined();
      expect(res?.named['SHOULDER_ROT']).toBeDefined();

      const neck = res!.named['NECK_BASE']!;
      const ls = res!.named['LEFT_SHOULDER']!;
      const rs = res!.named['RIGHT_SHOULDER']!;

      // Verify neck base is midway between left and right shoulders
      expect(neck.x).toBeCloseTo((ls.x + rs.x) / 2, 1);
      expect(neck.y).toBeCloseTo((ls.y + rs.y) / 2, 1);

      // Verify scaleRef is derived from shoulder span
      expect(res!.scaleRef).toBeGreaterThan(50);

      detector.dispose();
    });
  });

  describe('FaceDetector Nostril & Earlobe Landmarks', () => {
    it('emits real nostril alar base landmarks (LEFT_NOSE_WING, RIGHT_NOSE_WING)', async () => {
      const detector = new FaceDetector();

      // Test MediaPipe mesh conversion method directly
      const mockMesh = Array.from({ length: 478 }, (_, i) => ({
        x: 0.5 + (i % 10) * 0.01,
        y: 0.4 + (i % 8) * 0.01,
        z: 0.01,
      }));

      // Index 49 is left nose wing, index 279 is right nose wing
      mockMesh[49] = { x: 0.54, y: 0.45, z: 0 };
      mockMesh[279] = { x: 0.46, y: 0.45, z: 0 };
      mockMesh[234] = { x: 0.65, y: 0.42, z: 0 }; // left earlobe
      mockMesh[454] = { x: 0.35, y: 0.42, z: 0 }; // right earlobe
      mockMesh[468] = { x: 0.58, y: 0.38, z: 0 }; // left pupil
      mockMesh[473] = { x: 0.42, y: 0.38, z: 0 }; // right pupil

      const res = (detector as any)._processMediaPipeMesh(mockMesh, 1000, 1000);

      expect(res.kind).toBe('face');
      expect(res.named['LEFT_NOSE_WING']).toBeDefined();
      expect(res.named['RIGHT_NOSE_WING']).toBeDefined();
      expect(res.named['LEFT_NOSE_WING'].x).toBe(540);
      expect(res.named['RIGHT_NOSE_WING'].x).toBe(460);

      expect(res.named['LEFT_EAR_LOBE'].x).toBe(650);
      expect(res.named['RIGHT_EAR_LOBE'].x).toBe(350);

      expect(res.named['NOSE_WING_WIDTH']).toBeDefined();
      expect(res.named['NOSE_WING_WIDTH'].x).toBeCloseTo(80, 1);

      detector.dispose();
    });
  });

  describe('PoseFitter Multi-Category Fitting & Smoothing', () => {
    it('fits necklace anchored to collarbone with shoulder rotation', () => {
      const profile = AnchorRegistry.get(JewelleryKind.NECKLACE).defaultProfile;
      const fitter = new PoseFitter(profile, { scale: 1.0, rotationZ: 0 });

      const mockPoseLandmarks: LandmarkResult = {
        kind: 'pose',
        confidence: 0.95,
        points: [],
        named: {
          NECK_BASE: { x: 640, y: 400, name: 'NECK_BASE' },
          COLLARBONE: { x: 640, y: 415, name: 'COLLARBONE' },
          SHOULDER_ROT: { x: 0.08, y: 0, name: 'SHOULDER_ROT' },
        },
        scaleRef: 250,
      };

      let fit = fitter.fit(mockPoseLandmarks);
      for (let i = 0; i < 4; i++) {
        fit = fitter.fit(mockPoseLandmarks);
      }

      expect(fit.visible).toBe(true);
      expect(fit.confidence).toBeGreaterThan(0.8);
      // Fits smoothly around neck base with 4% collar drape offset (400 + 0.04 * 250 = 410)
      expect(fit.position.x).toBeCloseTo(640, 0);
      expect(fit.position.y).toBeCloseTo(410, 0);
      expect(fit.rotationZ).toBeCloseTo(0.08, 2);
      expect(fit.scale).toBeGreaterThan(1.0);
    });

    it('fits nose ring anchored to nostril wing with alar scale', () => {
      const profile = AnchorRegistry.get(JewelleryKind.NOSE_RING).defaultProfile;
      const fitter = new PoseFitter(profile, { scale: 0.7, rotationZ: 0 });

      const mockFaceLandmarks: LandmarkResult = {
        kind: 'face',
        confidence: 0.92,
        points: [],
        named: {
          LEFT_NOSE_WING: { x: 550, y: 380, name: 'LEFT_NOSE_WING' },
          NOSE_TIP: { x: 500, y: 375, name: 'NOSE_TIP' },
          HEAD_ROLL: { x: -0.05, y: 0, name: 'HEAD_ROLL' },
        },
        scaleRef: 120,
      };

      const fit = fitter.fit(mockFaceLandmarks);

      expect(fit.visible).toBe(true);
      expect(fit.position.x).toBeCloseTo(550, 0);
      expect(fit.position.y).toBeCloseTo(380, 0);
    });
  });
});
