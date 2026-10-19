import { describe, it, expect } from 'vitest';
import {
  isFaceCentered,
  evaluateFaceGuideStatus,
  shouldHideFaceGuide,
} from '../src/tracking/face-guide-state.js';

describe('Fix C: Face-Guide Centering & Stability State Logic', () => {
  const frame = { width: 1000, height: 800 };

  describe('isFaceCentered', () => {
    it('returns true when face landmark is in the central region', () => {
      // (500, 350) is 50% width and 43.75% height -> centered
      expect(isFaceCentered({ x: 500, y: 350 }, frame)).toBe(true);
      // Boundaries: 35% and 65% width
      expect(isFaceCentered({ x: 350, y: 300 }, frame)).toBe(true);
      expect(isFaceCentered({ x: 650, y: 400 }, frame)).toBe(true);
    });

    it('returns false when face landmark is far off-center horizontally', () => {
      // 20% width (too far left)
      expect(isFaceCentered({ x: 200, y: 350 }, frame)).toBe(false);
      // 85% width (too far right)
      expect(isFaceCentered({ x: 850, y: 350 }, frame)).toBe(false);
    });

    it('returns false when face landmark is far off-center vertically', () => {
      // 10% height (too high up)
      expect(isFaceCentered({ x: 500, y: 80 }, frame)).toBe(false);
      // 75% height (too low down)
      expect(isFaceCentered({ x: 500, y: 620 }, frame)).toBe(false);
    });

    it('handles null or invalid coordinates gracefully', () => {
      expect(isFaceCentered(null, frame)).toBe(false);
      expect(isFaceCentered(undefined, frame)).toBe(false);
      expect(isFaceCentered({ x: 500, y: 350 }, { width: 0, height: 0 })).toBe(false);
    });
  });

  describe('evaluateFaceGuideStatus', () => {
    it('returns NO_FACE when tracking is inactive', () => {
      const status = evaluateFaceGuideStatus({
        isTracking: false,
        isCentered: true,
        stabilityDurationMs: 500,
      });
      expect(status).toBe('NO_FACE');
    });

    it('returns OFF_CENTER when tracking is active but face is outside central window', () => {
      const status = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: false,
        stabilityDurationMs: 500,
      });
      expect(status).toBe('OFF_CENTER');
    });

    it('returns STABILIZING when face is centered but under 300ms threshold', () => {
      const at0ms = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: true,
        stabilityDurationMs: 0,
      });
      expect(at0ms).toBe('STABILIZING');

      const at200ms = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: true,
        stabilityDurationMs: 200,
      });
      expect(at200ms).toBe('STABILIZING');

      const at299ms = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: true,
        stabilityDurationMs: 299,
      });
      expect(at299ms).toBe('STABILIZING');
    });

    it('returns ALIGNED when face is centered and stable for >= 300ms', () => {
      const at300ms = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: true,
        stabilityDurationMs: 300,
      });
      expect(at300ms).toBe('ALIGNED');

      const at1000ms = evaluateFaceGuideStatus({
        isTracking: true,
        isCentered: true,
        stabilityDurationMs: 1000,
      });
      expect(at1000ms).toBe('ALIGNED');
    });
  });

  describe('shouldHideFaceGuide', () => {
    it('keeps guide visible during detection and first 299ms', () => {
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: true, stabilityDurationMs: 0 }),
      ).toBe(false);
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: true, stabilityDurationMs: 150 }),
      ).toBe(false);
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: true, stabilityDurationMs: 299 }),
      ).toBe(false);
    });

    it('hides guide once stable for 300ms or more', () => {
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: true, stabilityDurationMs: 300 }),
      ).toBe(true);
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: true, stabilityDurationMs: 600 }),
      ).toBe(true);
    });

    it('re-shows guide immediately when face drifts off center or tracking drops', () => {
      // Was stable, but now off-center
      expect(
        shouldHideFaceGuide({ isTracking: true, isCentered: false, stabilityDurationMs: 1200 }),
      ).toBe(false);

      // Was stable, but tracking lost
      expect(
        shouldHideFaceGuide({ isTracking: false, isCentered: true, stabilityDurationMs: 1200 }),
      ).toBe(false);
    });
  });
});
