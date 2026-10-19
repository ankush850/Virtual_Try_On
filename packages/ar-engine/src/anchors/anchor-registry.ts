import { JewelleryKind } from '@vj/shared';
import type { AnchorProfile } from '../types.js';

export type DetectorKind = 'face' | 'hand' | 'pose';

export type AnchorRegistration = {
  detector: DetectorKind;
  defaultProfile: AnchorProfile;
};

const registry = new Map<string, AnchorRegistration>();

function register(kind: string, value: AnchorRegistration) {
  registry.set(kind, value);
}

register(JewelleryKind.EARRINGS, {
  detector: 'face',
  defaultProfile: {
    primaryAnchor: 'LEFT_EAR_LOBE',
    secondaryAnchor: 'RIGHT_EAR_LOBE',
    scaleRef: 'FACE_WIDTH',
    offset: { x: 0, y: 0.02, z: 0 },
    minScale: 0.35,
    maxScale: 2.5,
  },
});

register(JewelleryKind.NECKLACE, {
  detector: 'pose',
  defaultProfile: {
    primaryAnchor: 'NECK_BASE',
    scaleRef: 'SHOULDER_WIDTH',
    offset: { x: 0, y: 0.04, z: 0 },
    minScale: 0.4,
    maxScale: 3.0,
  },
});

register(JewelleryKind.NOSE_RING, {
  detector: 'face',
  defaultProfile: {
    primaryAnchor: 'LEFT_NOSE_WING',
    secondaryAnchor: 'NOSE_TIP',
    scaleRef: 'NOSE_WING_WIDTH',
    offset: { x: 0, y: 0, z: 0 },
    minScale: 0.2,
    maxScale: 1.8,
  },
});

register(JewelleryKind.SUNGLASSES, {
  detector: 'face',
  defaultProfile: {
    primaryAnchor: 'LEFT_EYE',
    secondaryAnchor: 'RIGHT_EYE',
    scaleRef: 'FACE_WIDTH',
    offset: { x: 0, y: 0, z: 0 },
    minScale: 0.6,
    maxScale: 2.2,
  },
});

register(JewelleryKind.PENDANT, {
  detector: 'pose',
  defaultProfile: {
    primaryAnchor: 'NECK_BASE',
    secondaryAnchor: 'COLLARBONE',
    scaleRef: 'SHOULDER_WIDTH',
    offset: { x: 0, y: 0.12, z: 0 },
    minScale: 0.35,
    maxScale: 2.8,
  },
});

register(JewelleryKind.MANGALSUTRA, {
  detector: 'pose',
  defaultProfile: {
    primaryAnchor: 'NECK_BASE',
    secondaryAnchor: 'COLLARBONE',
    scaleRef: 'SHOULDER_WIDTH',
    offset: { x: 0, y: 0.08, z: 0 },
    minScale: 0.4,
    maxScale: 3.0,
  },
});

register(JewelleryKind.RINGS, {
  detector: 'hand',
  defaultProfile: {
    primaryAnchor: 'RING_SLOT_3',
    scaleRef: 'HAND_SCALE',
    offset: { x: 0, y: 0, z: 0 },
    minScale: 0.3,
    maxScale: 2,
  },
});

register(JewelleryKind.BANGLES, {
  detector: 'hand',
  defaultProfile: {
    primaryAnchor: 'BANGLE_ANCHOR',
    scaleRef: 'HAND_SCALE',
    offset: { x: 0, y: 0, z: 0 },
    minScale: 0.5,
    maxScale: 2.5,
  },
});

register(JewelleryKind.BRACELET, {
  detector: 'hand',
  defaultProfile: {
    primaryAnchor: 'WRIST',
    scaleRef: 'HAND_SCALE',
    offset: { x: 0, y: 0.02, z: 0 },
    minScale: 0.5,
    maxScale: 2.5,
  },
});

register(JewelleryKind.WATCH, {
  detector: 'hand',
  defaultProfile: {
    primaryAnchor: 'WRIST',
    scaleRef: 'HAND_SCALE',
    offset: { x: 0, y: 0, z: 0 },
    minScale: 0.5,
    maxScale: 2.5,
  },
});

export const AnchorRegistry = {
  get(kind: string): AnchorRegistration {
    const k = (kind ?? '').toUpperCase().trim();
    let found = registry.get(k);
    if (!found) {
      if (k === 'RING') found = registry.get(JewelleryKind.RINGS);
      else if (k === 'BANGLE') found = registry.get(JewelleryKind.BANGLES);
      else if (k === 'EARRING') found = registry.get(JewelleryKind.EARRINGS);
      else if (k === 'NECKLACES') found = registry.get(JewelleryKind.NECKLACE);
      else if (k === 'NOSE_RINGS' || k === 'NOSERING') found = registry.get(JewelleryKind.NOSE_RING);
    }
    if (!found) {
      found = registry.get(JewelleryKind.EARRINGS)!;
    }
    return found;
  },
  register,
  mergeProfile(kind: string, override?: Partial<AnchorProfile>): AnchorProfile {
    const base = this.get(kind).defaultProfile;
    return {
      ...base,
      ...override,
      offset: { ...base.offset, ...override?.offset },
    };
  },
};
