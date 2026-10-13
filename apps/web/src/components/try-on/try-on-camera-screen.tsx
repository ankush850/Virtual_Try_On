'use client';

import type { RefObject } from 'react';
import { CameraComponent, type CameraHud } from '@vj/ui';

export interface TryOnCameraScreenProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  threeRef: RefObject<HTMLCanvasElement | null>;
  running: boolean;
  starting: boolean;
  hud: CameraHud;
  mirrorOn: boolean;
  onStart: () => void;
  onStop: () => void;
  onFlip: () => void;
  onMirrorToggle: () => void;
  onCapture: () => void;
  productName?: string;
  className?: string;
}

export function TryOnCameraScreen({
  videoRef,
  overlayRef,
  threeRef,
  running,
  starting,
  hud,
  mirrorOn,
  onStart,
  onStop,
  onFlip,
  onMirrorToggle,
  onCapture,
  productName,
  className,
}: TryOnCameraScreenProps) {
  return (
    <div className={`relative w-full flex flex-col items-center ${className ?? ''}`}>
      <CameraComponent
        videoRef={videoRef}
        overlayRef={overlayRef}
        threeRef={threeRef}
        running={running}
        starting={starting}
        hud={hud}
        mirrorOn={mirrorOn}
        onStart={onStart}
        onStop={onStop}
        onFlip={onFlip}
        onMirrorToggle={onMirrorToggle}
        onCapture={onCapture}
        promptText={
          productName
            ? `Position yourself in front of camera to see ${productName} fitted in real-time.`
            : 'Position yourself in front of camera for real-time jewellery fitting.'
        }
      />
    </div>
  );
}
