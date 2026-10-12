import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { PoseFit } from '../types.js';

type LoadedAsset = {
  primary:   THREE.Group;
  secondary: THREE.Group | null;
};

/**
 * Phase 2 – Production ThreeRenderer.
 *
 * Enhancements:
 * - Asset cache with URL-keyed storage and LRU eviction.
 * - Dynamic product replacement without renderer teardown.
 * - DRACO compression support for faster asset downloads.
 * - Optimised lighting: ambient + directional key/fill + rim point light.
 * - Smooth visibility transitions (fade in/out via material opacity).
 * - Memory cleanup: dispose geometry, material and textures on replacement.
 * - Throttled render: only flushes WebGL when pose or visibility changes.
 * - Depth-aware z-positioning from PoseFit depthHint.
 * - Animation mixer support for animated GLTF models.
 * - Render quality scaling based on adaptive controller tier.
 * - Proper disposal of cached assets on cache eviction.
 */

const MAX_CACHED_ASSETS = 8;

export class ThreeRenderer {
  private renderer:  THREE.WebGLRenderer;
  private scene    = new THREE.Scene();
  private camera:    THREE.OrthographicCamera;
  private root     = new THREE.Group();
  private secondary = new THREE.Group();
  private ready    = false;

  // Asset caching with LRU
  private readonly assetCache = new Map<string, { group: THREE.Group; lastUsed: number }>();
  private currentAssetUrl: string | null = null;
  private mirrorSecondary = false;

  // Fade state
  private targetOpacity  = 1;
  private currentOpacity = 1;

  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private animations: THREE.AnimationClip[] = [];

  // Loaders (shared, singleton per renderer)
  private readonly gltfLoader: GLTFLoader;

  // Last rendered state for change detection
  private lastPoseKey = '';

  // Render quality
  private pixelRatioOverride: number | null = null;
  /** Procedural meshes own their geometry. Cached GLTF clones share it. */
  private instanceOwnsGeometry = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // ── WebGL renderer ────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha:                true,
      antialias:            true,
      preserveDrawingBuffer: true,
      powerPreference:      'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Enable tone mapping for better metallic appearance
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // ── Camera ────────────────────────────────────────────────────────────
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 2000);
    this.camera.position.z = 10;

    // ── Lighting ──────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);

    // Key light: warm directional from upper-right
    const key = new THREE.DirectionalLight(0xfff8e7, 1.4);
    key.position.set(0.5, 0.8, 1.5);

    // Fill light: cool directional from lower-left
    const fill = new THREE.DirectionalLight(0xddeeff, 0.4);
    fill.position.set(-1, -0.3, 0.8);

    // Rim/back light for metallic highlights
    const rim = new THREE.PointLight(0xffffff, 0.5, 800);
    rim.position.set(0, -200, 300);

    // Bottom fill for under-chin necklace illumination
    const bottomFill = new THREE.DirectionalLight(0xffeedd, 0.25);
    bottomFill.position.set(0, -1, 0.5);

    this.scene.add(ambient, key, fill, rim, bottomFill);

    // ── Groups ─────────────────────────────────────────────────────────────
    this.scene.add(this.root, this.secondary);

    // ── Loaders ────────────────────────────────────────────────────────────
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(draco);
  }

  // ─── Resize ────────────────────────────────────────────────────────────────

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    if (this.pixelRatioOverride != null) {
      this.renderer.setPixelRatio(this.pixelRatioOverride);
    }
    this.camera.left   = 0;
    this.camera.right  = width;
    this.camera.top    = 0;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
  }

  // ─── Quality control ───────────────────────────────────────────────────────

  setRenderQuality(tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL'): void {
    switch (tier) {
      case 'HIGH':
        this.pixelRatioOverride = Math.min(window.devicePixelRatio, 2);
        break;
      case 'MEDIUM':
        this.pixelRatioOverride = Math.min(window.devicePixelRatio, 1.5);
        break;
      case 'LOW':
        this.pixelRatioOverride = 1;
        break;
      case 'MINIMAL':
        this.pixelRatioOverride = 0.75;
        break;
    }
    this.renderer.setPixelRatio(this.pixelRatioOverride);
  }

  /** Map mean luminance (0 dark … 1 bright) onto tone-mapping exposure. */
  setExposure(luminance: number): void {
    const exposure = Math.max(0.75, Math.min(1.65, 1.15 + (0.45 - luminance) * 0.9));
    this.renderer.toneMappingExposure = exposure;
  }

  // ─── Asset loading ─────────────────────────────────────────────────────────

  loadProceduralEarring(mirrorSec = true): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createGoldDropEarring();
    this.root.add(mesh.clone(true));
    if (mirrorSec) {
      const sec = createGoldDropEarring();
      sec.scale.x = -1;
      this.secondary.add(sec);
    }
    this.mirrorSecondary = mirrorSec;
    this.currentAssetUrl  = 'procedural://earring';
    this.ready = true;
  }

  async loadModel(url: string, mirrorSec = false): Promise<void> {
    if (!url || url === 'procedural://earring') {
      this.loadProceduralEarring(mirrorSec);
      return;
    }

    // Check cache
    let cacheEntry = this.assetCache.get(url);
    if (cacheEntry) {
      cacheEntry.lastUsed = Date.now();
    } else {
      // Evict LRU if cache is full
      this._evictCacheIfNeeded();

      const gltf = await this.gltfLoader.loadAsync(url);

      // Apply PBR-friendly material tweaks to all meshes.
      gltf.scene.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.envMapIntensity = 0.8;
                m.needsUpdate     = true;
              }
            });
          }
        }
      });

      // Store animations if present
      if (gltf.animations && gltf.animations.length > 0) {
        this.animations = gltf.animations;
      }

      cacheEntry = { group: gltf.scene, lastUsed: Date.now() };
      this.assetCache.set(url, cacheEntry);
    }

    this._clearGroups();
    this.instanceOwnsGeometry = false;
    const primary = cacheEntry.group.clone(true);
    this._isolateMaterials(primary);
    this.root.add(primary);

    // Setup animation mixer if there are animations
    if (this.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(primary);
      this.animations.forEach((clip) => {
        const action = this.mixer!.clipAction(clip);
        action.play();
      });
      this.clock.start();
    }

    if (mirrorSec) {
      const sec = cacheEntry.group.clone(true);
      this._isolateMaterials(sec);
      sec.scale.x = -1;
      this.secondary.add(sec);
    }
    this.mirrorSecondary = mirrorSec;
    this.currentAssetUrl  = url;
    this.ready = true;
    this.targetOpacity = 0;   // fade in
    this.currentOpacity = 0;
  }

  // ─── Dynamic product switching ──────────────────────────────────────────────

  async switchAsset(url: string, mirrorSec: boolean): Promise<void> {
    // Fade out current first.
    this.targetOpacity = 0;
    await this._waitFrames(4);
    await this.loadModel(url, mirrorSec);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  render(pose: PoseFit): void {
    // Update animation mixer
    if (this.mixer) {
      const delta = this.clock.getDelta();
      this.mixer.update(delta);
    }

    // Fade animation.
    if (this.currentOpacity !== this.targetOpacity) {
      const fadeSpeed = this.targetOpacity > this.currentOpacity ? 0.22 : 0.15;
      this.currentOpacity += (this.targetOpacity - this.currentOpacity) * fadeSpeed;
      if (Math.abs(this.currentOpacity - this.targetOpacity) < 0.01) {
        this.currentOpacity = this.targetOpacity;
      }
    } else if (pose.visible) {
      this.targetOpacity = 1;
    }

    if (!this.ready) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!pose.visible || this.currentOpacity < 0.01) {
      this.root.visible      = false;
      this.secondary.visible = false;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.targetOpacity = 1;

    // Compute pose key for change detection.
    const poseKey = `${pose.position.x.toFixed(1)},${pose.position.y.toFixed(1)},${pose.scale.toFixed(3)},${pose.rotationZ.toFixed(4)},${this.currentOpacity.toFixed(2)}`;

    // Always render for fade animation, skip only when frozen.
    const needRender = poseKey !== this.lastPoseKey || this.mixer !== null;

    // Apply primary.
    this.root.visible = true;
    this.root.position.set(pose.position.x, pose.position.y, pose.depthHint ?? 0);
    this.root.rotation.z = -pose.rotationZ;
    const s = Math.max(0.3, pose.scale) * 18;
    this.root.scale.setScalar(s);
    this._setGroupOpacity(this.root, this.currentOpacity);

    // Apply secondary.
    if (pose.secondaryPosition) {
      this.secondary.visible = true;
      this.secondary.position.set(
        pose.secondaryPosition.x,
        pose.secondaryPosition.y,
        pose.depthHint ?? 0,
      );
      this.secondary.rotation.z = pose.rotationZ;
      this.secondary.scale.setScalar(s);
      this._setGroupOpacity(this.secondary, this.currentOpacity);
    } else {
      this.secondary.visible = false;
    }

    if (needRender) {
      this.lastPoseKey = poseKey;
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ─── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    this._clearGroups();
    this.assetCache.forEach((entry) => this._disposeGroup(entry.group, true));
    this.assetCache.clear();
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.animations = [];
    this.renderer.dispose();
  }

  // ─── Cache info ────────────────────────────────────────────────────────────

  getCacheStats() {
    return {
      size: this.assetCache.size,
      maxSize: MAX_CACHED_ASSETS,
      urls: [...this.assetCache.keys()],
      currentUrl: this.currentAssetUrl,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _clearGroups(): void {
    this._disposeGroup(this.root, this.instanceOwnsGeometry);
    this._disposeGroup(this.secondary, this.instanceOwnsGeometry);
    this.root.clear();
    this.secondary.clear();
    this.ready = false;
    this.lastPoseKey = '';
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.animations = [];
  }

  private _isolateMaterials(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
    });
  }

  private _disposeGroup(group: THREE.Group, disposeGeometry: boolean): void {
    group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        if (disposeGeometry) mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: THREE.Material) => {
          // Dispose all texture maps
          if ('map' in m && (m as THREE.MeshStandardMaterial).map) {
            (m as THREE.MeshStandardMaterial).map?.dispose();
          }
          if ('normalMap' in m && (m as THREE.MeshStandardMaterial).normalMap) {
            (m as THREE.MeshStandardMaterial).normalMap?.dispose();
          }
          if ('roughnessMap' in m && (m as THREE.MeshStandardMaterial).roughnessMap) {
            (m as THREE.MeshStandardMaterial).roughnessMap?.dispose();
          }
          if ('metalnessMap' in m && (m as THREE.MeshStandardMaterial).metalnessMap) {
            (m as THREE.MeshStandardMaterial).metalnessMap?.dispose();
          }
          if ('emissiveMap' in m && (m as THREE.MeshStandardMaterial).emissiveMap) {
            (m as THREE.MeshStandardMaterial).emissiveMap?.dispose();
          }
          if ('aoMap' in m && (m as THREE.MeshStandardMaterial).aoMap) {
            (m as THREE.MeshStandardMaterial).aoMap?.dispose();
          }
          m.dispose();
        });
      }
    });
  }

  private _setGroupOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: THREE.Material) => {
          m.transparent = opacity < 1;
          m.opacity     = opacity;
          m.needsUpdate = true;
        });
      }
    });
  }

  private _evictCacheIfNeeded(): void {
    while (this.assetCache.size >= MAX_CACHED_ASSETS) {
      // Find the least recently used entry
      let oldestUrl: string | null = null;
      let oldestTime = Infinity;
      for (const [url, entry] of this.assetCache) {
        if (url === this.currentAssetUrl) continue; // don't evict current
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestUrl = url;
        }
      }
      if (oldestUrl) {
        const entry = this.assetCache.get(oldestUrl);
        if (entry) this._disposeGroup(entry.group, true);
        this.assetCache.delete(oldestUrl);
      } else {
        break; // can't evict
      }
    }
  }

  private _waitFrames(n: number): Promise<void> {
    return new Promise((resolve) => {
      let count = 0;
      const step = () => { if (++count >= n) resolve(); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
}

// ─── Procedural gold earring ────────────────────────────────────────────────

function createGoldDropEarring(): THREE.Group {
  const group = new THREE.Group();
  const gold  = new THREE.MeshStandardMaterial({
    color:     0xd4af37,
    metalness: 0.97,
    roughness: 0.18,
    envMapIntensity: 0.9,
  });
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.032, 16, 32, Math.PI), gold,
  );
  hook.rotation.z = Math.PI;
  hook.position.y = 0.18;

  const connector = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), gold,
  );
  connector.position.y = 0.02;

  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 32), gold);
  bead.position.y = -0.06;

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.025, 0.14, 12), gold,
  );
  stem.position.y = -0.22;

  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.20, 32, 32), gold);
  drop.scale.set(0.78, 1.18, 0.78);
  drop.position.y = -0.40;

  group.add(hook, connector, bead, stem, drop);
  return group;
}
