import { describe, it, expect, vi } from 'vitest';
import { Canvas2dRenderer } from '../src/renderers/canvas2d-renderer.js';

describe('Fix D: Debug Overlay (?debug=1) Rendering', () => {
  function createMockCanvasContext() {
    const calls: Array<{ method: string; args: any[] }> = [];
    const textCalls: string[] = [];

    const ctx = {
      save: vi.fn(() => calls.push({ method: 'save', args: [] })),
      restore: vi.fn(() => calls.push({ method: 'restore', args: [] })),
      beginPath: vi.fn(() => calls.push({ method: 'beginPath', args: [] })),
      arc: vi.fn((...args: any[]) => calls.push({ method: 'arc', args })),
      moveTo: vi.fn((...args: any[]) => calls.push({ method: 'moveTo', args })),
      lineTo: vi.fn((...args: any[]) => calls.push({ method: 'lineTo', args })),
      stroke: vi.fn(() => calls.push({ method: 'stroke', args: [] })),
      fill: vi.fn(() => calls.push({ method: 'fill', args: [] })),
      fillRect: vi.fn((...args: any[]) => calls.push({ method: 'fillRect', args })),
      roundRect: vi.fn((...args: any[]) => calls.push({ method: 'roundRect', args })),
      setLineDash: vi.fn((...args: any[]) => calls.push({ method: 'setLineDash', args })),
      fillText: vi.fn((text: string, x: number, y: number) => {
        textCalls.push(text);
        calls.push({ method: 'fillText', args: [text, x, y] });
      }),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      set fillStyle(val: any) {},
      set strokeStyle(val: any) {},
      set lineWidth(val: any) {},
      set font(val: any) {},
      set textAlign(val: any) {},
      set shadowColor(val: any) {},
      set shadowBlur(val: any) {},
      set shadowOffsetX(val: any) {},
      set shadowOffsetY(val: any) {},
      set globalAlpha(val: any) {},
      set imageSmoothingEnabled(val: any) {},
      set imageSmoothingQuality(val: any) {},
    } as unknown as CanvasRenderingContext2D;

    const canvas = {
      width: 1280,
      height: 720,
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    return { canvas, ctx, calls, textCalls };
  }

  it('draws debug HUD box with FPS, status, latency, scale and shoulders state', () => {
    const { canvas, ctx, textCalls } = createMockCanvasContext();
    const renderer = new Canvas2dRenderer(canvas, ctx);

    renderer.drawDebugOverlay({
      fps: 30,
      latencyMs: 16.4,
      status: 'TRACKING',
      pose: {
        position: { x: 640, y: 420 },
        scale: 1.15,
        rotationZ: 0.05,
        confidence: 0.95,
        visible: true,
      },
      landmarks: {
        kind: 'pose',
        named: {
          LEFT_SHOULDER: { x: 780, y: 410 },
          RIGHT_SHOULDER: { x: 500, y: 410 },
          NECK_BASE: { x: 640, y: 410 },
          COLLARBONE: { x: 640, y: 432 },
        },
        scaleRef: 280,
        shouldersVisible: true,
      },
    });

    // Check that debug HUD text lines were rendered
    expect(textCalls.some((t) => t.includes('DEBUG (?debug=1)'))).toBe(true);
    expect(textCalls.some((t) => t.includes('FPS:       30'))).toBe(true);
    expect(textCalls.some((t) => t.includes('LATENCY:   16.4 ms'))).toBe(true);
    expect(textCalls.some((t) => t.includes('STATUS:    TRACKING'))).toBe(true);
    expect(textCalls.some((t) => t.includes('SCALE:     1.15'))).toBe(true);
    expect(textCalls.some((t) => t.includes('SHOULDERS: VISIBLE'))).toBe(true);
  });

  it('draws measured shoulder width and anchor crosshair', () => {
    const { canvas, ctx, textCalls } = createMockCanvasContext();
    const renderer = new Canvas2dRenderer(canvas, ctx);

    renderer.drawDebugOverlay({
      fps: 29,
      latencyMs: 14.2,
      status: 'TRACKING',
      pose: {
        position: { x: 640, y: 435 },
        scale: 1.2,
        rotationZ: 0,
        confidence: 0.94,
        visible: true,
      },
      landmarks: {
        kind: 'pose',
        named: {
          LEFT_SHOULDER: { x: 800, y: 400 },
          RIGHT_SHOULDER: { x: 500, y: 400 }, // span = 300px
          NECK_BASE: { x: 650, y: 400 },
          COLLARBONE: { x: 650, y: 424 },
          LEFT_EAR: { x: 720, y: 250 },
          RIGHT_EAR: { x: 580, y: 250 }, // face span = 140px
        },
        scaleRef: 300,
        shouldersVisible: true,
      },
    });

    // Verify shoulder width measurement badge
    expect(textCalls.some((t) => t.includes('Shoulders: 300px'))).toBe(true);
    // Verify face width measurement badge
    expect(textCalls.some((t) => t.includes('Face: 140px'))).toBe(true);
    // Verify anchor point coordinate badge
    expect(textCalls.some((t) => t.includes('ANCHOR (640, 435)'))).toBe(true);
  });

  it('handles null landmarks and pose without throwing errors', () => {
    const { canvas, ctx } = createMockCanvasContext();
    const renderer = new Canvas2dRenderer(canvas, ctx);

    expect(() => {
      renderer.drawDebugOverlay({
        fps: 0,
        status: 'INITIALIZING',
        landmarks: null,
        pose: null,
      });
    }).not.toThrow();
  });
});
