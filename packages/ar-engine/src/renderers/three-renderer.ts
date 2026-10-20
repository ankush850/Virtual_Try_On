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
  private occluder:  THREE.Mesh;
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

    // ── Depth-Buffer Face Occluder (colorWrite = false, depthWrite = true) ──
    const occluderGeo = new THREE.SphereGeometry(1.0, 24, 24);
    occluderGeo.scale(0.85, 1.15, 0.95);
    const occluderMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
    this.occluder = new THREE.Mesh(occluderGeo, occluderMat);
    this.occluder.renderOrder = -1;
    this.occluder.visible = false;
    this.scene.add(this.occluder);

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
    this.currentAssetUrl = 'procedural://earring';
    this.ready = true;
  }

  loadProceduralNecklace(): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createChokerNecklace();
    this.root.add(mesh);
    this.mirrorSecondary = false;
    this.secondary.visible = false;
    this.currentAssetUrl = 'procedural://necklace';
    this.ready = true;
  }

  loadProceduralNoseRing(): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createSeptumNoseRing();
    this.root.add(mesh);
    this.mirrorSecondary = false;
    this.secondary.visible = false;
    this.currentAssetUrl = 'procedural://nose_ring';
    this.ready = true;
  }

  loadProceduralRing(): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createSolitaireRing();
    this.root.add(mesh);
    this.mirrorSecondary = false;
    this.secondary.visible = false;
    this.currentAssetUrl = 'procedural://ring';
    this.ready = true;
  }

  loadProceduralBangle(): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createKadaBangle();
    this.root.add(mesh);
    this.mirrorSecondary = false;
    this.secondary.visible = false;
    this.currentAssetUrl = 'procedural://bangle';
    this.ready = true;
  }

  loadProcedural(kind: string, mirrorSec = false): void {
    const normalized = (kind || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (normalized.includes('necklace')) {
      this.loadProceduralNecklace();
    } else if (normalized.includes('nose') || normalized.includes('septum')) {
      this.loadProceduralNoseRing();
    } else if (normalized.includes('ring')) {
      this.loadProceduralRing();
    } else if (normalized.includes('bangle') || normalized.includes('bracelet')) {
      this.loadProceduralBangle();
    } else if (normalized.includes('earring')) {
      this.loadProceduralEarring(mirrorSec);
    } else {
      this.loadProceduralFallback(kind);
    }
  }

  loadProceduralFallback(kind: string): void {
    this._clearGroups();
    this.instanceOwnsGeometry = true;
    const mesh = createPlaceholderBadge(kind);
    this.root.add(mesh);
    this.mirrorSecondary = false;
    this.secondary.visible = false;
    this.currentAssetUrl = `procedural://${kind}`;
    this.ready = true;
  }

  async loadModel(url: string, mirrorSec = false): Promise<void> {
    if (!url || url.startsWith('procedural://')) {
      const kind = url ? url.replace('procedural://', '').trim() : 'earring';
      this.loadProcedural(kind, mirrorSec);
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

    // Occluder mesh transform for head occlusion
    if (pose.secondaryPosition) {
      const midX = (pose.position.x + pose.secondaryPosition.x) / 2;
      const midY = (pose.position.y + pose.secondaryPosition.y) / 2;
      const headDist = Math.hypot(
        pose.secondaryPosition.x - pose.position.x,
        pose.secondaryPosition.y - pose.position.y,
      );
      const headRadius = headDist * 0.55;
      this.occluder.visible = true;
      this.occluder.position.set(midX, midY - headRadius * 0.1, (pose.depthHint ?? 0) - 20);
      this.occluder.scale.set(headRadius * 0.95, headRadius * 1.35, headRadius * 1.1);
      this.occluder.rotation.y = pose.yaw ?? 0;
      this.occluder.rotation.x = pose.pitch ?? 0;
      this.occluder.rotation.z = -pose.rotationZ;
    } else {
      this.occluder.visible = false;
    }

    // Far-side earring fade when head turns past ~35 degrees (|yaw| > 0.61 rad)
    let rootOpacity = this.currentOpacity;
    let secOpacity  = this.currentOpacity;
    if (pose.secondaryPosition && pose.yaw !== undefined) {
      const FAR_YAW_THRESHOLD = 0.61; // ~35 deg
      const FAR_YAW_MAX = 0.85;       // ~48.7 deg
      const absYaw = Math.abs(pose.yaw);
      if (absYaw > FAR_YAW_THRESHOLD) {
        const fade = Math.max(0, 1 - (absYaw - FAR_YAW_THRESHOLD) / (FAR_YAW_MAX - FAR_YAW_THRESHOLD));
        const primaryIsSmallerX = pose.position.x < pose.secondaryPosition.x;
        if (pose.yaw > 0) {
          if (primaryIsSmallerX) {
            rootOpacity *= fade;
          } else {
            secOpacity *= fade;
          }
        } else {
          if (primaryIsSmallerX) {
            secOpacity *= fade;
          } else {
            rootOpacity *= fade;
          }
        }
      }
    }

    // Apply primary.
    const s = Math.max(0.3, pose.scale) * 18;
    if (rootOpacity > 0.01) {
      this.root.visible = true;
      this.root.position.set(pose.position.x, pose.position.y, pose.depthHint ?? 0);
      this.root.rotation.z = -pose.rotationZ;
      this.root.scale.setScalar(s);
      this._setGroupOpacity(this.root, rootOpacity);
    } else {
      this.root.visible = false;
    }

    // Apply secondary.
    if (pose.secondaryPosition && secOpacity > 0.01) {
      this.secondary.visible = true;
      this.secondary.position.set(
        pose.secondaryPosition.x,
        pose.secondaryPosition.y,
        pose.depthHint ?? 0,
      );
      this.secondary.rotation.z = pose.rotationZ;
      this.secondary.scale.setScalar(s);
      this._setGroupOpacity(this.secondary, secOpacity);
    } else {
      this.secondary.visible = false;
    }

    if (needRender) {
      this.lastPoseKey = poseKey;
      this.renderer.render(this.scene, this.camera);
    }
  }

  getOccluder(): THREE.Mesh {
    return this.occluder;
  }

  clearJewellery(): void {
    this._clearGroups();
    this.ready = false;
    this.currentAssetUrl = null;
    this.root.visible = false;
    this.secondary.visible = false;
    try {
      this.renderer.clear();
    } catch {
      // In non-WebGL environments (e.g. testing) ignore clear error
    }
  }

  hasActiveMesh(): boolean {
    return this.ready && (this.root.children.length > 0 || this.secondary.children.length > 0);
  }

  getActiveUrl(): string | null {
    return this.currentAssetUrl;
  }

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

// ─── Procedural jewellery for other categories ──────────────────────────────

function createGoldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.95,
    roughness: 0.18,
    envMapIntensity: 1.0,
  });
}

function createGemMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.05,
    envMapIntensity: 1.2,
  });
}

function createChokerNecklace(): THREE.Group {
  const group = new THREE.Group();
  const gold = createGoldMaterial();
  const gem = createGemMaterial();

  // Collar collar curve (arc resting around clavicle / neck base)
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.045, 16, 64, Math.PI * 0.8),
    gold,
  );
  collar.rotation.z = Math.PI * 0.1;
  collar.rotation.x = Math.PI * 0.25;

  // Central bail ring
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 12, 24), gold);
  bail.position.set(0, -1.2, 0);

  // Central pendant stone
  const pendant = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), gem);
  pendant.scale.set(0.85, 1.35, 0.85);
  pendant.position.set(0, -1.55, 0.05);

  group.add(collar, bail, pendant);
  return group;
}

function createSeptumNoseRing(): THREE.Group {
  const group = new THREE.Group();
  const gold = createGoldMaterial();
  const gem = createGemMaterial();

  // Small hoop
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.022, 16, 32, Math.PI * 1.65),
    gold,
  );
  hoop.rotation.z = Math.PI * 0.18;

  // Diamond accent bead
  const accent = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), gem);
  accent.position.set(0, -0.12, 0);

  group.add(hoop, accent);
  return group;
}

function createSolitaireRing(): THREE.Group {
  const group = new THREE.Group();
  const gold = createGoldMaterial();
  const gem = createGemMaterial();

  // Finger band
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 16, 32), gold);

  // Raised crown collet
  const collet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.14, 12), gold);
  collet.position.set(0, 0.32, 0);

  // Center Solitaire
  const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), gem);
  stone.position.set(0, 0.44, 0);

  group.add(band, collet, stone);
  return group;
}

function createKadaBangle(): THREE.Group {
  const group = new THREE.Group();
  const gold = createGoldMaterial();

  // Main cuff
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.075, 20, 48), gold);

  // Twin ornamental terminal knobs
  const leftKnob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), gold);
  leftKnob.position.set(-0.8, 0, 0);

  const rightKnob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), gold);
  rightKnob.position.set(0.8, 0, 0);

  group.add(cuff, leftKnob, rightKnob);
  return group;
}

function createPlaceholderBadge(_category: string): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.8,
    roughness: 0.2,
    wireframe: true,
  });
  const box = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 16, 32), mat);
  group.add(box);
  return group;
}
