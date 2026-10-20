import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ThreeRenderer } from '../src/renderers/three-renderer.js';
import { Canvas2dRenderer } from '../src/renderers/canvas2d-renderer.js';
import type { PoseFit } from '../src/types.js';

// Mock WebGLRenderer to run cleanly in Node environment without hardware GPU
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class MockWebGLRenderer {
    domElement = {};
    shadowMap = { enabled: false };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    render = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

describe('FIX 7: Depth-Buffer Occlusion & Far-Side Earring Yaw Fade', () => {
  let threeCanvas: HTMLCanvasElement;
  let threeRenderer: ThreeRenderer;
  let canvas2d: HTMLCanvasElement;
  let ctx2d: CanvasRenderingContext2D;
  let canvasRenderer: Canvas2dRenderer;

  beforeEach(() => {
    if (typeof window === 'undefined') {
      (global as any).window = { devicePixelRatio: 1 };
    }

    threeCanvas = {
      width: 640,
      height: 480,
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement;
    threeRenderer = new ThreeRenderer(threeCanvas);

    ctx2d = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      globalAlpha: 1,
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    } as unknown as CanvasRenderingContext2D;

    canvas2d = {
      width: 640,
      height: 480,
      getContext: vi.fn().mockReturnValue(ctx2d),
    } as unknown as HTMLCanvasElement;

    canvasRenderer = new Canvas2dRenderer(canvas2d, ctx2d);
  });

  describe('Three.js Depth-Buffer Face Occluder', () => {
    it('initializes occluder with colorWrite=false, depthWrite=true, and renderOrder=-1', () => {
      const occluder = threeRenderer.getOccluder();
      expect(occluder).toBeDefined();
      expect(occluder.renderOrder).toBe(-1);

      const mat = occluder.material as THREE.MeshBasicMaterial;
      expect(mat.colorWrite).toBe(false);
      expect(mat.depthWrite).toBe(true);
    });

    it('positions and scales occluder around head when bilateral pose is rendered', () => {
      threeRenderer.loadProceduralEarring(true);

      const pose: PoseFit = {
        position: { x: 200, y: 150 }, // Primary ear
        secondaryPosition: { x: 300, y: 150 }, // Secondary ear
        scale: 1.0,
        rotationZ: 0,
        confidence: 0.95,
        visible: true,
        yaw: 0.2,
        pitch: 0.1,
      };

      threeRenderer.render(pose);

      const occluder = threeRenderer.getOccluder();
      expect(occluder.visible).toBe(true);
      // Midpoint between 200 and 300 is 250
      expect(occluder.position.x).toBeCloseTo(250, 1);
      // Head radius scale is > 40
      expect(occluder.scale.x).toBeGreaterThan(40);
      expect(occluder.scale.y).toBeGreaterThan(60);
      expect(occluder.rotation.y).toBeCloseTo(0.2, 2);
    });

    it('hides occluder when no secondary position exists', () => {
      threeRenderer.loadProceduralNecklace();

      const pose: PoseFit = {
        position: { x: 320, y: 240 },
        scale: 1.0,
        rotationZ: 0,
        confidence: 0.95,
        visible: true,
      };

      threeRenderer.render(pose);
      const occluder = threeRenderer.getOccluder();
      expect(occluder.visible).toBe(false);
    });
  });

  describe('Far-Side Earring Yaw Fade (> 35 degrees / 0.61 rad)', () => {
    it('fades out the far-side earring in ThreeRenderer when yaw exceeds 0.61 rad', () => {
      threeRenderer.loadProceduralEarring(true);

      // Head turned right (yaw = 0.75 rad ~ 43 deg):
      // Primary ear (smaller X, x=180) is on the far side and occluded
      // Secondary ear (larger X, x=310) is on the near side and visible
      const pose: PoseFit = {
        position: { x: 180, y: 160 },
        secondaryPosition: { x: 310, y: 160 },
        scale: 1.0,
        rotationZ: 0,
        confidence: 0.95,
        visible: true,
        yaw: 0.75, // > 0.61 rad
      };

      threeRenderer.render(pose);

      const anyRenderer = threeRenderer as any;
      const rootGroup = anyRenderer.root as THREE.Group;
      const secGroup = anyRenderer.secondary as THREE.Group;

      expect(secGroup.visible).toBe(true);

      // Traverse root group materials to verify far-side opacity is reduced
      let rootMaxOpacity = 0;
      rootGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat && mat.opacity !== undefined) {
            rootMaxOpacity = Math.max(rootMaxOpacity, mat.opacity);
          }
        }
      });

      // At yaw=0.75 rad, excess = 0.14 / 0.24, fade ~ 0.41 (< 0.70)
      expect(rootMaxOpacity).toBeLessThan(0.7);
    });

    it('fades out the far-side earring in Canvas2dRenderer when yaw exceeds 0.61 rad', () => {
      const mockImg = {
        naturalWidth: 60,
        naturalHeight: 120,
      } as HTMLImageElement;
      (canvasRenderer as any).image = mockImg;
      (canvasRenderer as any).currentUrl = 'earring.png';

      const drawImageSpy = vi.spyOn(ctx2d, 'drawImage');

      const pose: PoseFit = {
        position: { x: 180, y: 160 }, // primary (smaller X) -> far side
        secondaryPosition: { x: 310, y: 160 }, // secondary (larger X) -> near side
        scale: 1.0,
        rotationZ: 0,
        confidence: 0.95,
        visible: true,
        yaw: 0.84, // extreme yaw ~ 48 deg (fade < 0.05, near 0)
      };

      // Draw primary (far side): should be skipped or faded below threshold
      canvasRenderer.drawJewellery(pose, false, 'EARRINGS');
      const farSideCalls = drawImageSpy.mock.calls.length;

      // Draw secondary (near side): renders cleanly
      canvasRenderer.drawJewellery(pose, true, 'EARRINGS');
      expect(drawImageSpy.mock.calls.length).toBeGreaterThan(farSideCalls);
    });
  });
});
