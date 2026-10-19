# AR Tracking Specification & Anatomical Landmark Mapping

This document specifies the computer vision models, landmark indices, anatomical anchor calculations, dynamic scale sources, and rotation derivations used by the Virtual Jewellery Try-On AR Engine.

---

## 1. Category to Model & Landmark Mapping

| Category | Tracking Model | Landmark Indices | Anchor Derivation | Scale Source | Rotation Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EARRINGS** | MediaPipe Face Landmarker (478 pts) *(BlazeFace fallback)* | • Left Earlobe: `234`, `132`<br>• Right Earlobe: `454`, `361`<br>• Jawline: `172`, `397`<br>• Pupils: `468`, `473` | Earlobe base attachment (`LEFT_EAR_LOBE` & `RIGHT_EAR_LOBE`) with jawline angle stabilization | Real Interpupillary Distance (IPD between landmarks `468` & `473`) or Zygomatic Face Width | Head Roll ($\text{atan2}(\Delta y, \Delta x)$ between eye centers) with yaw-compensated 3D perspective |
| **NOSE RING** | MediaPipe Face Landmarker (478 pts) *(BlazeFace fallback)* | • Left Alar Crease: `49`, `240`<br>• Right Alar Crease: `279`, `460`<br>• Nose Tip: `4`<br>• Subnasale: `2`<br>• Bridge: `168` | Anchored directly to real nostril wing (`LEFT_NOSE_WING` / `RIGHT_NOSE_WING`) at the alar groove, not approximated from nose tip | Real Nose Wing Width ($\text{dist}(\text{pt}_{49}, \text{pt}_{279})$) | 3D head yaw + pitch + roll vector derived from the nasal symmetry axis |
| **NECKLACE** | MediaPipe Pose Landmarker (33 pts) | • Left Shoulder: `11`<br>• Right Shoulder: `12`<br>• Clavicle / Neck Base: Midpoint(`11`, `12`)<br>• Nose: `0` | Midpoint between left and right shoulders (`NECK_BASE`) resting naturally on the collarbone/suprasternal notch (`COLLARBONE`), **never anchored to the chin** | Real Biacromial Shoulder Width ($\text{hypot}(x_{12} - x_{11}, y_{12} - y_{11})$) | Clavicle / Shoulder line tilt ($\text{atan2}(y_{11} - y_{12}, x_{11} - x_{12})$) |
| **PENDANT / MANGALSUTRA** | MediaPipe Pose Landmarker (33 pts) | • Left Shoulder: `11`<br>• Right Shoulder: `12`<br>• Neck Base: Midpoint(`11`, `12`)<br>• Sternum / Clavicle | Midpoint between shoulders with vertical chain drape offset along the torso axis | Real Biacromial Shoulder Width | Torso coronal tilt angle ($\text{atan2}(y_{11} - y_{12}, x_{11} - x_{12})$) |
| **RINGS** | MediaPipe Hand Landmarker (21 pts) | • Ring Finger MCP: `13`<br>• Ring Finger PIP: `14`<br>• Ring Finger DIP: `15`<br>• Middle Finger MCP: `9`<br>• Pinky MCP: `17` | Proximal phalanx joint midpoint: $0.45 \cdot P_{\text{MCP}} + 0.55 \cdot P_{\text{PIP}}$ (`RING_SLOT_3` for ring finger, slot `0..4` selectable) | Real Finger Width derived from inter-knuckle span ($\text{dist}(P_{\text{ring\_mcp}}, P_{\text{middle\_mcp}})$) | Finger longitudinal direction vector ($P_{\text{PIP}} - P_{\text{MCP}}$) |
| **BANGLES / BRACELET** | MediaPipe Hand Landmarker (21 pts) | • Wrist Joint: `0`<br>• Index MCP: `5`<br>• Middle MCP: `9`<br>• Pinky MCP: `17` | Wrist center (`WRIST` / `BANGLE_ANCHOR`) positioned between the styloid processes and the carpal tunnel | Real Wrist & Palm Width ($\text{hypot}(x_{17} - x_5, y_{17} - y_5)$) | Forearm longitudinal vector ($\text{palm\_center} - P_{\text{wrist}}$) |

---

## 2. Dynamic Measurement Scaling vs Fixed Offsets

Every category now derives dimensions from real physical human anatomy:
- **Earrings**: Scaled dynamically using Interpupillary Distance (IPD) or zygomatic face width. When user moves closer or further from the camera, earrings scale precisely with the ears without manual scaling parameters.
- **Nose Ring**: Scaled from the patient's real nose wing span (alar base width). Adapts automatically whether the user has a delicate or wider nasal profile.
- **Necklaces & Pendants**: Scaled from real shoulder-to-shoulder width (acromial breadth). Never drifts when tilting the head or opening the mouth because tracking is decoupled from facial landmarks.
- **Rings & Bangles**: Scaled from real hand anatomy (distance between metacarpophalangeal joints and wrist breadth).

---

## 3. Landmark Temporal Smoothing

To eliminate high-frequency jitter while preserving rapid responsiveness during movement:
1. **Per-Landmark Exponential Moving Average (EMA)**:
   $$\hat{P}_t = \alpha \cdot P_t + (1 - \alpha) \cdot \hat{P}_{t-1}$$
   - Adaptive $\alpha \in [0.5, 0.85]$ based on tracking confidence and frame count.
2. **Spring-Damper Physical Filter (`PoseFitter`)**:
   - Simulates physical mass, spring stiffness ($k = 0.35$), and damping ($\zeta = 0.72$) on fitted coordinates $(x, y, \text{scale}, \theta)$.
   - Prevents abrupt visual pops on landmark occlusion or rapid head turns.

---

## 4. Category-Specific Model Lazy-Loading

To ensure instant loading times and conserve user bandwidth and GPU memory:
- Models are instantiated **strictly on-demand** per active category:
  - When trying **Earrings** or **Nose Rings**: only the **Face** model is loaded (~3.5 MB). Hand and Pose models are never fetched.
  - When switching to a **Necklace**: the **Pose** model is loaded on demand.
  - When switching to a **Ring** or **Bangle**: the **Hand** model is loaded on demand.
- Hot-swapping between items in the same category reuses the already resident model instance without reload latency.
- The `AdaptiveController` monitors frame time budget and throttles inference cadence automatically on lower-spec hardware.
