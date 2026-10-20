# Third-Party Licenses and Reference Attribution

This document records the license audit for all reference repositories, libraries, and tools referenced during the development of the WebAR Virtual Jewellery Try-On engine.

In accordance with strict open-source licensing compliance:
- Every library or reference repository listed was audited for its `LICENSE` terms prior to utilization or adaptation.
- Only code licensed under permissive open-source licenses (**MIT**, **Apache-2.0**, **BSD**, **CC0**, or **CC-BY**) has been adopted or used as architectural reference.
- No proprietary, commercial SDKs (e.g. GlamAR, Ammazza, Lunaar), GPL/AGPL, or NonCommercial code has been included.

---

## Reference Repositories & Libraries Audit

| Library / Repository | Source URL | License Found | Exactly What Was Used |
| :--- | :--- | :--- | :--- |
| **`@mediapipe/tasks-vision`** | https://www.npmjs.com/package/@mediapipe/tasks-vision | **Apache-2.0** | Production dependency: MediaPipe Tasks Vision runtime for FaceLandmarker, PoseLandmarker, and HandLandmarker in browser WebAssembly. |
| **`three`** | https://github.com/mrdoob/three.js | **MIT** | Production dependency: WebGL scene graph, camera, PBR materials, lights, and rendering pipeline in `ThreeRenderer`. |
| **`google-ai-edge/mediapipe-samples`** | https://github.com/google-ai-edge/mediapipe-samples | **Apache-2.0** (Code) / **CC-BY 4.0** (Docs) | Reference patterns: Landmarker options initialization, video timestamp handling, and landmark coordinate normalization. |
| **`spite/FaceMeshFaceGeometry`** (`face-mesh-face-geometry`) | https://github.com/spite/FaceMeshFaceGeometry | **MIT** | Reference architecture & geometry: Canonical 468-point face mesh triangulation, depth-buffer face occluder geometry (`colorWrite=false, depthWrite=true`), and surface triangle anchor pinning. |
| **`pmndrs/drei`** (`@react-three/drei`) | https://github.com/pmndrs/drei | **MIT** | Architectural pattern reference: Facemesh UV mapping conventions and normal estimation across facial landmarks. |
| **`damiansire/web-ar-hand-tracking`** | https://github.com/damiansire/web-ar-hand-tracking | **MIT** | Reference pattern: Hand Landmarker multi-point orientation vectors, knuckle alignment, and Web Worker messaging design. |
| **`WebAR-rocks/WebAR.rocks.hand`** | https://github.com/WebAR-rocks/WebAR.rocks.hand | **MIT** | Architectural reference only: Wrist and forearm vector tracking for bangles and watches. No proprietary code copied. |
| **`WebAR-rocks/WebAR.rocks.face`** | https://github.com/WebAR-rocks/WebAR.rocks.face | **MIT** | Architectural reference only: Earring earlobe attachment and rotation stabilization principles. No proprietary code copied. |

---

## Prohibited & Excluded Tools
- **ARJewelBox / Unity WebGL**: Not used. Monorepo is strictly standards-compliant HTML5/WebGL/TypeScript.
- **Paid SDKs (GlamAR, Ammazza, Lunaar)**: Not used. All tracking, geometric fitting, occlusion, and rendering logic is natively implemented.
