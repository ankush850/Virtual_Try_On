import type { LandmarkResult, PoseFit, Vec2 } from '../types.js';

/**
 * Coordinate Transform Utilities for AR Engine.
 *
 * Single Source of Truth Architecture:
 * - Engine operates strictly in raw, unmirrored camera pixel coordinates ([0, width] x [0, height]).
 * - Live preview mirroring is performed exclusively via CSS transform (-scale-x-100) on the shared wrapper.
 * - Captured snapshot mirroring is performed exclusively during composite stage in CaptureCompositor.
 *
 * This eliminates double-mirroring bugs where coordinates were flipped in both the engine and CSS.
 */

/**
 * Transforms a point from raw camera coordinates to visual screen coordinates.
 */
export function transformToScreen(point: Vec2, frameWidth: number, isMirrored: boolean): Vec2 {
  if (!isMirrored) {
    return { x: point.x, y: point.y };
  }
  return {
    x: frameWidth - point.x,
    y: point.y,
  };
}

/**
 * Transforms a fitted pose into visual screen coordinate space.
 */
export function transformPoseToScreen(pose: PoseFit, frameWidth: number, isMirrored: boolean): PoseFit {
  if (!isMirrored) return { ...pose };

  return {
    ...pose,
    position: {
      x: frameWidth - pose.position.x,
      y: pose.position.y,
    },
    secondaryPosition: pose.secondaryPosition
      ? {
          x: frameWidth - pose.secondaryPosition.x,
          y: pose.secondaryPosition.y,
        }
      : undefined,
    rotationZ: -pose.rotationZ,
  };
}

export interface EarMappingResult {
  physicalLeftEar: {
    rawCoordinate: Vec2;
    screenCoordinate: Vec2;
    physicalSide: 'LEFT';
    screenSide: 'LEFT' | 'RIGHT';
  };
  physicalRightEar: {
    rawCoordinate: Vec2;
    screenCoordinate: Vec2;
    physicalSide: 'RIGHT';
    screenSide: 'LEFT' | 'RIGHT';
  };
}

/**
 * Resolves physical ear mapping and verifies correct anatomical placement
 * across front-facing (mirrored) and rear-facing (unmirrored) camera modes.
 *
 * Subject's anatomy:
 * - When facing the camera sensor, the subject's physical LEFT ear is imaged
 *   on the sensor's RIGHT side (raw X > frameWidth / 2).
 * - The subject's physical RIGHT ear is imaged on the sensor's LEFT side (raw X < frameWidth / 2).
 *
 * Preview modes:
 * - Front camera (isMirrored = true): The preview is flipped horizontally (mirror reflection).
 *   The subject's physical left ear appears on the LEFT of the screen, matching their reflection.
 * - Rear camera (isMirrored = false): The preview is unmirrored (true sight).
 *   Looking at someone facing you, their left ear is on your right.
 */
export function resolvePhysicalEarMapping(
  leftEarPoint: Vec2,
  rightEarPoint: Vec2,
  frameWidth: number,
  isMirrored: boolean,
): EarMappingResult {
  const leftScreen = transformToScreen(leftEarPoint, frameWidth, isMirrored);
  const rightScreen = transformToScreen(rightEarPoint, frameWidth, isMirrored);

  const midX = frameWidth / 2;

  return {
    physicalLeftEar: {
      rawCoordinate: leftEarPoint,
      screenCoordinate: leftScreen,
      physicalSide: 'LEFT',
      screenSide: leftScreen.x < midX ? 'LEFT' : 'RIGHT',
    },
    physicalRightEar: {
      rawCoordinate: rightEarPoint,
      screenCoordinate: rightScreen,
      physicalSide: 'RIGHT',
      screenSide: rightScreen.x < midX ? 'LEFT' : 'RIGHT',
    },
  };
}
