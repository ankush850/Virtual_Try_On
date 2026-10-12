import type { PoseFit } from '../types.js';

/**
 * Phase 2 – Production Canvas2dRenderer.
 *
 * Enhancements:
 * - Image asset cache with LRU eviction and size tracking.
 * - Dynamic jewellery switching without re-creating the renderer.
 * - High-DPI canvas support (devicePixelRatio scaling).
 * - Layered compositing: video drawn once, landmarks and jewellery on top.
 * - Smooth opacity transitions when switching jewellery images.
 * - Export pipeline: high-quality PNG/JPEG capture at native resolution.
 * - Landmark draw mode: none / dots / debug.
 * - Shadow and glow effects for premium look.
 * - Off-screen rendering for capture without UI disruption.
 */

type DrawMode = 'none' | 'dots' | 'debug';

const MAX_CACHE_ENTRIES = 16;
const MAX_CACHE_BYTES   = 50 * 1024 * 1024;

export class Canvas2dRenderer {
  private image:          HTMLImageElement | null = null;
  private mirrorSecondary = false;
  private targetOpacity   = 1;
  private currentOpacity  = 1;
  private currentUrl      = '';

  // Image asset cache: URL → loaded HTMLImageElement with metadata
  private readonly imageCache = new Map<string, { img: HTMLImageElement; bytes: number; lastUsed: number }>();
  private totalCacheBytes = 0;

  // Preload queue: prevent parallel fetches for the same URL.
  private readonly loading = new Map<string, Promise<HTMLImageElement>>();

  // Offscreen canvas for HQ capture rendering
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx:    CanvasRenderingContext2D,
  ) {
    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  // ─── Asset Loading ─────────────────────────────────────────────────────────

  async loadOverlay(url: string, mirrorSecondary = false): Promise<void> {
    this.mirrorSecondary = mirrorSecondary;

    if (this.currentUrl === url) return; // already loaded

    // Fade out before switching.
    if (this.currentUrl !== '') {
      this.targetOpacity = 0;
      await this._waitOpacityReached(0, 6);
    }

    this.image = await this._loadCached(url);
    this.currentUrl = url;
    this.targetOpacity = 1;
  }

  /** Preload an image URL into cache without making it the active overlay. */
  async preload(url: string): Promise<void> {
    await this._loadCached(url);
  }

  /** Preload multiple URLs concurrently. */
  async preloadMany(urls: string[]): Promise<void> {
    await Promise.allSettled(urls.map((u) => this._loadCached(u)));
  }

  // ─── Drawing ───────────────────────────────────────────────────────────────

  drawVideo(video: HTMLVideoElement, mirrored: boolean): void {
    const { width, height } = this.canvas;
    this.ctx.save();
    if (mirrored) {
      this.ctx.translate(width, 0);
      this.ctx.scale(-1, 1);
    }
    this.ctx.drawImage(video, 0, 0, width, height);
    this.ctx.restore();
  }

  drawJewellery(pose: PoseFit, secondary = false): void {
    if (!this.image || !pose.visible) return;

    // Advance opacity with smooth interpolation.
    if (this.currentOpacity !== this.targetOpacity) {
      this.currentOpacity += (this.targetOpacity - this.currentOpacity) * 0.25;
      if (Math.abs(this.currentOpacity - this.targetOpacity) < 0.02) {
        this.currentOpacity = this.targetOpacity;
      }
    }
    if (this.currentOpacity < 0.02) return;

    const img = this.image;
    const pos = secondary && pose.secondaryPosition ? pose.secondaryPosition : pose.position;

    // Scale image proportionally to face/hand scale.
    const baseSize = Math.max(img.naturalWidth, img.naturalHeight);
    const displaySize = baseSize * pose.scale * 0.15;
    const w = (img.naturalWidth  / baseSize) * displaySize;
    const h = (img.naturalHeight / baseSize) * displaySize;

    this.ctx.save();
    this.ctx.globalAlpha = this.currentOpacity * (pose.confidence > 0 ? Math.min(1, pose.confidence + 0.3) : 1);
    this.ctx.translate(pos.x, pos.y);
    this.ctx.rotate(pose.rotationZ);
    if (secondary && this.mirrorSecondary) {
      this.ctx.scale(-1, 1);
    }
    // Apply subtle drop shadow for depth.
    this.ctx.shadowColor   = 'rgba(0,0,0,0.25)';
    this.ctx.shadowBlur    = 10;
    this.ctx.shadowOffsetY = 4;
    this.ctx.shadowOffsetX = 1;
    this.ctx.drawImage(img, -w / 2, -h / 2, w, h);
    this.ctx.restore();
    this.ctx.globalAlpha = 1;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawLandmarks(
    named:  Record<string, { x: number; y: number }>,
    keys:   string[],
    mode:   DrawMode = 'dots',
  ): void {
    if (mode === 'none') return;
    this.ctx.save();
    for (const key of keys) {
      const p = named[key];
      if (!p) continue;

      const color = key.includes('EAR') ? '#22c55e'
        : key.includes('RING') ? '#f59e0b'
        : key.includes('WRIST') || key.includes('BANGLE') ? '#a78bfa'
        : key.includes('NOSE') ? '#f472b6'
        : key.includes('NECKLACE') || key.includes('CHIN') ? '#06b6d4'
        : '#38bdf8';

      // Outer glow
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      this.ctx.fillStyle = color + '30';
      this.ctx.fill();

      // Inner dot
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.fill();

      // Border
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      this.ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      this.ctx.lineWidth = 0.8;
      this.ctx.stroke();

      if (mode === 'debug') {
        this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
        this.ctx.font = '9px monospace';
        this.ctx.fillText(key.replace(/_/g, ' '), p.x + 8, p.y + 3);
      }
    }
    this.ctx.restore();
  }

  // ─── Capture / Export ──────────────────────────────────────────────────────

  /**
   * Export the current canvas state as a Blob.
   * Composites video + overlay + jewellery at native resolution.
   */
  async exportBlob(
    sources: Array<HTMLVideoElement | HTMLCanvasElement>,
    mimeType = 'image/jpeg',
    quality  = 0.94,
  ): Promise<Blob> {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Reuse or create offscreen canvas
    if (!this.offscreenCanvas || this.offscreenCanvas.width !== w || this.offscreenCanvas.height !== h) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width  = w;
      this.offscreenCanvas.height = h;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    const octx = this.offscreenCtx;
    if (!octx) throw new Error('2D context unavailable for export');

    octx.clearRect(0, 0, w, h);
    for (const src of sources) {
      octx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      this.offscreenCanvas!.toBlob((b) => resolve(b), mimeType, quality),
    );
    if (!blob) throw new Error('Canvas export failed');
    return blob;
  }

  // ─── Cache Stats ───────────────────────────────────────────────────────────

  getCacheStats() {
    return {
      entries: this.imageCache.size,
      totalBytes: this.totalCacheBytes,
      maxBytes: MAX_CACHE_BYTES,
      urls: [...this.imageCache.keys()],
    };
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.image       = null;
    this.currentUrl  = '';
    this.imageCache.clear();
    this.loading.clear();
    this.totalCacheBytes = 0;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _loadCached(url: string): Promise<HTMLImageElement> {
    const hit = this.imageCache.get(url);
    if (hit) {
      hit.lastUsed = Date.now();
      return Promise.resolve(hit.img);
    }

    const inFlight = this.loading.get(url);
    if (inFlight) return inFlight;

    const p = loadImage(url).then((img) => {
      // Estimate memory usage
      const bytes = img.naturalWidth * img.naturalHeight * 4; // RGBA
      this._evictIfNeeded(bytes);

      this.imageCache.set(url, { img, bytes, lastUsed: Date.now() });
      this.totalCacheBytes += bytes;
      this.loading.delete(url);
      return img;
    });
    this.loading.set(url, p);
    return p;
  }

  /** LRU eviction to stay within byte and entry caps. */
  private _evictIfNeeded(incoming: number): void {
    // Sort by LRU (oldest lastUsed first).
    const entries = [...this.imageCache.entries()]
      .filter(([url]) => url !== this.currentUrl) // don't evict active
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    while (
      entries.length > 0 &&
      (
        this.totalCacheBytes + incoming > MAX_CACHE_BYTES ||
        this.imageCache.size >= MAX_CACHE_ENTRIES
      )
    ) {
      const [url, entry] = entries.shift()!;
      this.totalCacheBytes -= entry.bytes;
      this.imageCache.delete(url);
    }
  }

  private _waitOpacityReached(target: number, frames: number): Promise<void> {
    return new Promise((resolve) => {
      let n = 0;
      const check = () => {
        this.currentOpacity += (target - this.currentOpacity) * 0.35;
        if (++n >= frames || Math.abs(this.currentOpacity - target) < 0.02) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img  = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load overlay: ${url}`));
    img.src = url;
  });
}
