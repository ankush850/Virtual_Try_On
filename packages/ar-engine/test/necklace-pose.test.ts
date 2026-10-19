import { describe, it, expect } from 'vitest';
import { JewelleryKind } from '@vj/shared';
import { AnchorRegistry } from '../src/anchors/anchor-registry.js';
import { PoseDetector } from '../src/detectors/pose-detector.js';
import { PoseFitter } from '../src/fitting/pose-fitter.js';
import type { LandmarkResult } from '../src/types.js';

describe('Fix A: Necklace Shoulder Anchoring, Scale, and Visibility', () => {
  describe('Necklace Anchor Computation from Shoulders', () => {
    it('anchors necklace to collarbone / neck base shifted toward chest from shoulder keypoints', async () => {
      const detector = new PoseDetector();
      await detector.load();

      // Test with mock landmark points simulating MediaPipe Pose keypoints
      const width = 1000;
      const height = 800;

      // Simulate input with shoulders:
      // Left shoulder at (700, 400), Right shoulder at (300, 400) -> span = 400px
      const mockPoseLandmarks33 = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
      mockPoseLandmarks33[0] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 }; // Nose
      mockPoseLandmarks33[7] = { x: 0.6, y: 0.23, z: 0, visibility: 0.9 };  // Left Ear
      mockPoseLandmarks33[8] = { x: 0.4, y: 0.23, z: 0, visibility: 0.9 };  // Right Ear
      mockPoseLandmarks33[11] = { x: 0.7, y: 0.5, z: 0, visibility: 0.92 }; // Left Shoulder
      mockPoseLandmarks33[12] = { x: 0.3, y: 0.5, z: 0, visibility: 0.92 }; // Right Shoulder

      // Feed through the detector's processing
      (detector as any).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [mockPoseLandmarks33] }),
      };

      const res = await detector.estimate({ width, height } as HTMLCanvasElement);
      expect(res).not.toBeNull();
      expect(res!.shouldersVisible).toBe(true);

      const ls = res!.named['LEFT_SHOULDER']!;
      const rs = res!.named['RIGHT_SHOULDER']!;
      const neck = res!.named['NECK_BASE']!;
      const collarbone = res!.named['COLLARBONE']!;

      expect(ls.x).toBeCloseTo(700, 1);
      expect(rs.x).toBeCloseTo(300, 1);

      // Midpoint between shoulders
      expect(neck.x).toBeCloseTo((ls.x + rs.x) / 2, 1);
      expect(neck.y).toBeCloseTo((ls.y + rs.y) / 2, 1);

      // Collarbone is shifted toward the chest (positive y from neck base)
      const span = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      expect(collarbone.y).toBeGreaterThan(neck.y);
      expect(collarbone.y).toBeCloseTo(neck.y + span * 0.08, 1);
      expect(collarbone.x).toBeCloseTo(neck.x, 1);

      // Necklace anchor is mapped to collarbone
      expect(res!.named['NECKLACE_ANCHOR']!.y).toBeCloseTo(collarbone.y, 1);

      detector.dispose();
    });

    it('falls back to face width for scale when shoulders are compressed or narrow', async () => {
      const detector = new PoseDetector();
      await detector.load();

      const width = 1000;
      const height = 800;

      // Narrow shoulders (span = 100px) with face ear span = 160px
      const mockPoseLandmarks33 = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
      mockPoseLandmarks33[0] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
      mockPoseLandmarks33[7] = { x: 0.58, y: 0.25, z: 0, visibility: 0.9 }; // Left Ear (580px)
      mockPoseLandmarks33[8] = { x: 0.42, y: 0.25, z: 0, visibility: 0.9 }; // Right Ear (420px) -> faceWidth = 160px
      mockPoseLandmarks33[11] = { x: 0.55, y: 0.5, z: 0, visibility: 0.9 }; // Left Shoulder (550px)
      mockPoseLandmarks33[12] = { x: 0.45, y: 0.5, z: 0, visibility: 0.9 }; // Right Shoulder (450px) -> span = 100px

      (detector as any).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [mockPoseLandmarks33] }),
      };

      const res = await detector.estimate({ width, height } as HTMLCanvasElement);
      expect(res).not.toBeNull();

      // Because shoulderSpan (100) < faceWidth * 1.3 (208), scaleRef should use faceWidth fallback (~160 * 2.3 = 368)
      expect(res!.scaleRef).toBeGreaterThan(250);

      detector.dispose();
    });
  });

  describe('Shoulder Visibility and Out-of-Frame Warning Logic', () => {
    it('sets shouldersVisible = false when shoulders are cut off at bottom of camera frame', async () => {
      const detector = new PoseDetector();
      await detector.load();

      const width = 1000;
      const height = 800;

      // Shoulders at y = 0.98 (below camera cut-off threshold)
      const mockPoseLandmarks33 = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
      mockPoseLandmarks33[11] = { x: 0.7, y: 0.98, z: 0, visibility: 0.8 };
      mockPoseLandmarks33[12] = { x: 0.3, y: 0.98, z: 0, visibility: 0.8 };

      (detector as any).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [mockPoseLandmarks33] }),
      };

      const res = await detector.estimate({ width, height } as HTMLCanvasElement);
      expect(res).not.toBeNull();
      expect(res!.shouldersVisible).toBe(false);

      detector.dispose();
    });

    it('sets shouldersVisible = false when shoulder detection confidence is low', async () => {
      const detector = new PoseDetector();
      await detector.load();

      const width = 1000;
      const height = 800;

      // Low visibility (visibility = 0.2)
      const mockPoseLandmarks33 = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
      mockPoseLandmarks33[11] = { x: 0.7, y: 0.5, z: 0, visibility: 0.2 };
      mockPoseLandmarks33[12] = { x: 0.3, y: 0.5, z: 0, visibility: 0.2 };

      (detector as any).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [mockPoseLandmarks33] }),
      };

      const res = await detector.estimate({ width, height } as HTMLCanvasElement);
      expect(res).not.toBeNull();
      expect(res!.shouldersVisible).toBe(false);

      detector.dispose();
    });

    it('does not render necklace when shouldersVisible is false', () => {
      const profile = AnchorRegistry.get(JewelleryKind.NECKLACE).defaultProfile;
      const fitter = new PoseFitter(profile, { scale: 1.0, rotationZ: 0 });

      const mockPoseLandmarks: LandmarkResult = {
        kind: 'pose',
        confidence: 0.9,
        points: [],
        named: {
          NECK_BASE: { x: 500, y: 400, name: 'NECK_BASE' },
          COLLARBONE: { x: 500, y: 425, name: 'COLLARBONE' },
          SHOULDER_ROT: { x: 0, y: 0, name: 'SHOULDER_ROT' },
        },
        scaleRef: 300,
        shouldersVisible: false, // User too close / shoulders out of frame
      };

      const fit = fitter.fit(mockPoseLandmarks);
      expect(fit.visible).toBe(false); // Must NOT draw necklace in wrong place
    });

    it('renders necklace when shouldersVisible is true', () => {
      const profile = AnchorRegistry.get(JewelleryKind.NECKLACE).defaultProfile;
      const fitter = new PoseFitter(profile, { scale: 1.0, rotationZ: 0 });

      const mockPoseLandmarks: LandmarkResult = {
        kind: 'pose',
        confidence: 0.9,
        points: [],
        named: {
          NECK_BASE: { x: 500, y: 400, name: 'NECK_BASE' },
          COLLARBONE: { x: 500, y: 425, name: 'COLLARBONE' },
          SHOULDER_ROT: { x: 0, y: 0, name: 'SHOULDER_ROT' },
        },
        scaleRef: 300,
        shouldersVisible: true,
      };

      const fit = fitter.fit(mockPoseLandmarks);
      expect(fit.visible).toBe(true);
      expect(fit.position.x).toBeCloseTo(500, 0);
      expect(fit.position.y).toBeCloseTo(412, 1); // 400 + 0.04 * 300 offset
    });
  });
});
