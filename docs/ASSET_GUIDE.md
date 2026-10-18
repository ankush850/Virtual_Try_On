# Virtual Jewellery AR Asset Specification Guide

This guide outlines the technical requirements and authoring standards for supplying 3D models and 2D sprite overlays to the Virtual Jewellery Try-On platform.

---

## 1. Supported File Formats

| Asset Type | Format | Extension | Compression / Codec |
| :--- | :--- | :--- | :--- |
| **3D Realtime Model** | glTF 2.0 Binary | `.glb` | Draco geometry compression recommended |
| **3D JSON Model** | glTF 2.0 Embedded | `.gltf` | Embedded base64 buffers or bundled bin |
| **2D High-Res Overlay** | Portable Network Graphics | `.png` | 32-bit RGBA (8-bit alpha channel transparency) |
| **2D Optimized Web** | WebP Image | `.webp` | Lossless / near-lossless with transparency |
| **Vector Placeholder** | Scalable Vector Graphics | `.svg` | Clean SVG with viewBox, no external fonts |

---

## 2. 3D Model Technical Specifications

To achieve smooth 60 FPS performance on mid-tier mobile devices (iPhone 11+, Samsung Galaxy A52+):

### Geometry & Polygon Budget
- **Earrings:** 5,000 – 15,000 triangles (tri-count per single earring).
- **Rings:** 10,000 – 25,000 triangles (including stone facets and prongs).
- **Necklaces / Chokers:** 15,000 – 40,000 triangles (segmented links or curved collar).
- **Bangles / Bracelets:** 8,000 – 20,000 triangles.
- **Nose Rings / Studs:** 2,000 – 8,000 triangles.
- **Hard Maximum:** 50,000 triangles for mobile; 100,000 for high-end desktop.
- **Topology:** Manifold geometry, closed caps, no degenerate faces or zero-area polygons.

### Scale & Coordinate System
- **Units:** 1 unit = 1 meter in glTF standard (or 1 unit = 1 cm when exported with uniform scaling).
- **Orientation:**
  - Forward: $+Z$
  - Up: $+Y$
  - Right: $+X$
- **Origin / Pivot Point (0, 0, 0):**
  - **Earrings:** Top of the hook / ear-post insertion point.
  - **Necklaces:** Rear nape / hollow-of-neck center point where the chain loops.
  - **Nose Rings:** Center of the nostril puncture or septum apex.
  - **Rings:** Geometric center of the finger hole (inner circumference center).
  - **Bangles:** Center of the wrist aperture.

### PBR Materials & Textures
- **Material Model:** Metallic-Roughness PBR workflow (`MeshStandardMaterial` / `MeshPhysicalMaterial`).
- **Texture Resolutions:**
  - Base Color / Albedo: $1024 \times 1024$ or $2048 \times 2048$ (PNG/JPEG/KTX2).
  - Metallic + Roughness + AO (packed into ORM channels): $1024 \times 1024$.
  - Normal Map: $1024 \times 1024$ (tangent-space normal map, OpenGL orientation $+Y$).
- **Gold & Metal Presets:**
  - Yellow Gold: Color `#d4af37`, Metalness `0.95 - 0.98`, Roughness `0.15 - 0.25`.
  - White Gold / Platinum: Color `#e5e7eb`, Metalness `0.95`, Roughness `0.12 - 0.20`.
  - Rose Gold: Color `#e0a899`, Metalness `0.95`, Roughness `0.18 - 0.24`.
- **Diamonds & Gems:**
  - High transmission / refraction index ($IOR = 2.42$ for diamonds).
  - EnvMap intensity: `0.8 - 1.2` for realistic studio lighting reflection.

### File Size Limits
- Maximum single asset file size: **25 MB**.
- Recommended optimized size: **1 MB – 6 MB** per piece.

---

## 3. 2D Image Overlay Specifications

- **Dimensions:** Square $1024 \times 1024$ px or $2048 \times 2048$ px.
- **Background:** 100% transparent background (no white, gray, or checkboard box).
- **Drop Shadows:** Optional soft contact shadow baked into alpha channel.
- **Color Profile:** sRGB.

---

## 4. Anchor Profiles & Engine Alignment Conventions

When configuring assets via Admin Studio or database records:

| Category | Primary Anchor (`anchorType`) | Landmark Reference | Default Scale | Rotation Z | Mirroring (`mirrorForOppositeEar`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Earrings** | `EAR_LOBE` | Left / Right earlobes | `1.0` | $0^\circ$ | `true` (mirrors opposite earring) |
| **Necklace** | `NECK_BASE` | Collarbone & shoulder base | `1.0` | $0^\circ$ | `false` |
| **Nose Ring** | `NOSE_WING` | Left/right nasal ala / septum | `0.7` | $0^\circ$ | `false` |
| **Ring** | `FINGER_BASE` | Ring finger proximal joint | `1.0` | $0^\circ$ | `false` (`fingerIndex: 3`) |
| **Bangle** | `WRIST` | Wrist center joint | `1.2` | $0^\circ$ | `false` |
