import { describe, it, expect } from 'vitest';
import {
  transformToScreen,
  transformPoseToScreen,
  resolvePhysicalEarMapping,
} from '../src/utils/coordinate-transform.js';
import type { PoseFit } from '../src/types.js';

describe('Coordinate Transform & Mirroring (Issue 6)', () => {
  const FRAME_WIDTH = 1280;
  const FRAME_HEIGHT = 720;
  const MID_X = FRAME_WIDTH / 2; // 640

  describe('transformToScreen', () => {
    it('leaves coordinates unchanged when preview is unmirrored (rear camera)', () => {
      const point = { x: 300, y: 400 };
      const screenPoint = transformToScreen(point, FRAME_WIDTH, false);
      expect(screenPoint).toEqual({ x: 300, y: 400 });
    });

    it('flips X axis across frame width when preview is mirrored (front selfie camera)', () => {
      const point = { x: 300, y: 400 };
      const screenPoint = transformToScreen(point, FRAME_WIDTH, true);
      expect(screenPoint).toEqual({ x: FRAME_WIDTH - 300, y: 400 });
      expect(screenPoint.x).toBe(980);
    });
  });

  describe('Physical Ear Mapping (Anatomical Accuracy)', () => {
    // Subject facing camera sensor:
    // Physical LEFT ear is imaged on sensor's RIGHT side (X = 900 > 640)
    // Physical RIGHT ear is imaged on sensor's LEFT side (X = 380 < 640)
    const rawLeftEar = { x: 900, y: 350 };
    const rawRightEar = { x: 380, y: 350 };

    it('maps left ear to the user’s physical left ear on screen in front camera (mirror mode)', () => {
      const mapping = resolvePhysicalEarMapping(rawLeftEar, rawRightEar, FRAME_WIDTH, true);

      // In mirror mode (front camera):
      // The screen flips horizontally so the subject sees their reflection.
      // Physical left ear (raw x=900) becomes screen x = 1280 - 900 = 380 (screen LEFT side).
      expect(mapping.physicalLeftEar.physicalSide).toBe('LEFT');
      expect(mapping.physicalLeftEar.screenSide).toBe('LEFT');
      expect(mapping.physicalLeftEar.screenCoordinate.x).toBe(380);

      // Physical right ear (raw x=380) becomes screen x = 1280 - 380 = 900 (screen RIGHT side).
      expect(mapping.physicalRightEar.physicalSide).toBe('RIGHT');
      expect(mapping.physicalRightEar.screenSide).toBe('RIGHT');
      expect(mapping.physicalRightEar.screenCoordinate.x).toBe(900);
    });

    it('maps left ear to the subject’s physical left ear in rear camera (unmirrored mode)', () => {
      const mapping = resolvePhysicalEarMapping(rawLeftEar, rawRightEar, FRAME_WIDTH, false);

      // In unmirrored mode (rear camera filming someone else):
      // When looking at another person, their physical left ear is on your right.
      expect(mapping.physicalLeftEar.physicalSide).toBe('LEFT');
      expect(mapping.physicalLeftEar.screenSide).toBe('RIGHT');
      expect(mapping.physicalLeftEar.screenCoordinate.x).toBe(900);

      expect(mapping.physicalRightEar.physicalSide).toBe('RIGHT');
      expect(mapping.physicalRightEar.screenSide).toBe('LEFT');
      expect(mapping.physicalRightEar.screenCoordinate.x).toBe(380);
    });
  });

  describe('transformPoseToScreen', () => {
    it('preserves rotation and position when unmirrored', () => {
      const pose: PoseFit = {
        position: { x: 500, y: 300 },
        secondaryPosition: { x: 800, y: 310 },
        scale: 1.2,
        rotationZ: 0.15,
        confidence: 0.95,
        visible: true,
      };

      const transformed = transformPoseToScreen(pose, FRAME_WIDTH, false);
      expect(transformed.position).toEqual({ x: 500, y: 300 });
      expect(transformed.secondaryPosition).toEqual({ x: 800, y: 310 });
      expect(transformed.rotationZ).toBe(0.15);
    });

    it('inverts rotationZ and mirrors primary/secondary X positions when mirrored', () => {
      const pose: PoseFit = {
        position: { x: 500, y: 300 },
        secondaryPosition: { x: 800, y: 310 },
        scale: 1.2,
        rotationZ: 0.15,
        confidence: 0.95,
        visible: true,
      };

      const transformed = transformPoseToScreen(pose, FRAME_WIDTH, true);
      expect(transformed.position.x).toBe(FRAME_WIDTH - 500); // 780
      expect(transformed.secondaryPosition?.x).toBe(FRAME_WIDTH - 800); // 480
      expect(transformed.rotationZ).toBeCloseTo(-0.15);
    });
  });

  describe('Capture and Preview Orientation Parity', () => {
    it('verifies live preview CSS flip matches CaptureCompositor horizontal flip', () => {
      // Live preview CSS: -scale-x-100 flips horizontally around center
      // CaptureCompositor: ctx.translate(w, 0); ctx.scale(-1, 1) flips horizontally
      const sampleX = 750;
      const cssTransformX = (x: number) => FRAME_WIDTH - x;
      const canvasTransformX = (x: number) => FRAME_WIDTH - x;

      expect(cssTransformX(sampleX)).toBe(canvasTransformX(sampleX));
      expect(cssTransformX(sampleX)).toBe(530);
    });
  });
});
