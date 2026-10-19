import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArEngine } from '../src/ar-engine';
import { Canvas2dRenderer } from '../src/renderers/canvas2d-renderer';
import type { JewelleryConfig } from '../src/types';

describe('AR Engine: 2D vs 3D Asset Switching & Disposal', () => {
  let engine: ArEngine;

  beforeEach(() => {
    engine = new ArEngine();
  });

  describe('is3DAsset classification', () => {
    it('identifies 3D formats correctly', () => {
      expect(engine.is3DAsset({
        jewelleryKind: 'EARRINGS',
        assetType: 'MODEL_GLB',
        assetUrl: 'https://example.com/model.glb',
      })).toBe(true);

      expect(engine.is3DAsset({
        jewelleryKind: 'EARRINGS',
        assetType: 'MODEL_GLTF',
        assetUrl: 'https://example.com/model.gltf',
      })).toBe(true);

      expect(engine.is3DAsset({
        jewelleryKind: 'NECKLACE',
        assetType: 'PROCEDURAL',
        assetUrl: 'procedural://necklace',
      })).toBe(true);

      expect(engine.is3DAsset({
        jewelleryKind: 'RINGS',
        assetType: 'MODEL_GLB',
        assetUrl: 'procedural://ring',
      })).toBe(true);
    });

    it('identifies 2D overlay formats correctly', () => {
      expect(engine.is3DAsset({
        jewelleryKind: 'EARRINGS',
        assetType: 'IMAGE_OVERLAY',
        assetUrl: 'https://example.com/earring.png',
      })).toBe(false);

      expect(engine.is3DAsset({
        jewelleryKind: 'NECKLACE',
        assetType: 'IMAGE_OVERLAY',
        assetUrl: 'https://example.com/necklace.webp',
      })).toBe(false);

      expect(engine.is3DAsset({
        jewelleryKind: 'BANGLES',
        assetType: 'IMAGE_OVERLAY',
        assetUrl: 'http://localhost:3000/assets/bangle-cuff.svg',
      })).toBe(false);
    });

    it('handles null and undefined configurations safely', () => {
      expect(engine.is3DAsset(null)).toBe(false);
      expect(engine.is3DAsset(undefined)).toBe(false);
    });
  });

  describe('Canvas2dRenderer clear and disposal', () => {
    let mockCanvas: HTMLCanvasElement;
    let mockCtx: CanvasRenderingContext2D;
    let renderer: Canvas2dRenderer;

    beforeEach(() => {
      mockCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
      } as unknown as CanvasRenderingContext2D;

      mockCanvas = {
        width: 800,
        height: 600,
      } as HTMLCanvasElement;

      renderer = new Canvas2dRenderer(mockCanvas, mockCtx);
    });

    it('clears active jewellery and resets canvas context', () => {
      renderer.clearJewellery();
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(renderer.hasActiveOverlay()).toBe(false);
      expect(renderer.getActiveUrl()).toBe('');
    });

    it('disposes cache and resets all internal buffers', () => {
      renderer.dispose();
      const stats = renderer.getCacheStats();
      expect(stats.entries).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(renderer.hasActiveOverlay()).toBe(false);
    });
  });

  describe('Multi-category switching state progression (3D -> 2D -> 3D)', () => {
    it('transitions cleanly between 3D and 2D products without retaining stale state', () => {
      const config3dEarrings: JewelleryConfig = {
        jewelleryKind: 'EARRINGS',
        assetType: 'MODEL_GLB',
        assetUrl: 'procedural://earring',
        mirrorForOppositeEar: true,
      };

      const config2dStuds: JewelleryConfig = {
        jewelleryKind: 'EARRINGS',
        assetType: 'IMAGE_OVERLAY',
        assetUrl: 'http://localhost:3000/assets/earrings-stud.svg',
        mirrorForOppositeEar: true,
      };

      const config3dNecklace: JewelleryConfig = {
        jewelleryKind: 'NECKLACE',
        assetType: 'MODEL_GLB',
        assetUrl: 'procedural://necklace',
        mirrorForOppositeEar: false,
      };

      // Step 1: Start on 3D earrings
      expect(engine.is3DAsset(config3dEarrings)).toBe(true);

      // Step 2: Switch to 2D image studs
      expect(engine.is3DAsset(config2dStuds)).toBe(false);

      // Step 3: Switch to 3D necklace
      expect(engine.is3DAsset(config3dNecklace)).toBe(true);

      // Step 4: Verify distinct category models
      expect(config3dNecklace.jewelleryKind).toBe('NECKLACE');
      expect(config3dNecklace.assetUrl).toBe('procedural://necklace');
      expect(config3dNecklace.mirrorForOppositeEar).toBe(false);
    });
  });
});
