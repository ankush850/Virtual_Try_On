'use client';

import * as React from 'react';
import { Camera, FlipHorizontal, RefreshCw, Sun, Sparkles, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';

export interface CameraHud {
  status: string;
  fps: number;
  error?: string;
}

export interface CameraComponentProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  threeRef: React.RefObject<HTMLCanvasElement | null>;
  running: boolean;
  starting: boolean;
  hud: CameraHud;
  mirrorOn: boolean;
  onStart: () => void;
  onStop: () => void;
  onFlip: () => void;
  onMirrorToggle: () => void;
  onCapture: () => void;
  captureDisabled?: boolean;
  aspectRatioClass?: string;
  className?: string;
  promptText?: string;
}

export function CameraComponent({
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
  captureDisabled = false,
  aspectRatioClass = 'aspect-[3/4]',
  className,
  promptText = 'Position yourself in front of the camera for real-time jewellery fitting.',
}: CameraComponentProps) {
  const [guideOn, setGuideOn] = React.useState(true);
  const [brightMode, setBrightMode] = React.useState(false);
  const [countdown, setCountdown] = React.useState<number | null>(null);
  const [flashing, setFlashing] = React.useState(false);

  const triggerShutter = React.useCallback(() => {
    if (captureDisabled || !running || countdown !== null) return;
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setFlashing(true);
          setTimeout(() => setFlashing(false), 250);
          onCapture();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [captureDisabled, running, countdown, onCapture]);

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-border/80 bg-black shadow-2xl transition-all',
        aspectRatioClass,
        brightMode ? 'brightness-110 contrast-105' : '',
        className,
      )}
    >
      {/* Underlying WebCam Video Element */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-transform',
          mirrorOn ? '-scale-x-100' : 'scale-x-100',
          running ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* 2D Canvas for landmarks/contours */}
      <canvas
        ref={overlayRef}
        className={cn(
          'absolute inset-0 h-full w-full pointer-events-none transition-transform',
          mirrorOn ? '-scale-x-100' : 'scale-x-100',
        )}
      />

      {/* Three.js 3D WebGL Canvas for 3D jewellery rendering */}
      <canvas
        ref={threeRef}
        className={cn(
          'absolute inset-0 h-full w-full pointer-events-none transition-transform',
          mirrorOn ? '-scale-x-100' : 'scale-x-100',
        )}
      />

      {/* Shutter Flash Animation */}
      {flashing ? (
        <div className="absolute inset-0 z-40 bg-white/90 animate-out fade-out duration-200 pointer-events-none" />
      ) : null}

      {/* Countdown Overlay */}
      {countdown !== null ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <span className="font-serif text-8xl font-bold text-primary animate-ping duration-700 drop-shadow-lg">
            {countdown}
          </span>
        </div>
      ) : null}

      {/* Subtle AR Alignment Guide Overlay */}
      {running && guideOn ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <div className="relative h-[65%] w-[60%] rounded-[45%] border border-dashed border-primary/40 opacity-70 animate-pulse">
            <div className="absolute top-[28%] left-[20%] right-[20%] border-t border-dotted border-primary/30" />
            <div className="absolute top-[50%] left-[30%] right-[30%] border-t border-dotted border-primary/30" />
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-primary/80 font-mono">
              Align Face
            </div>
          </div>
        </div>
      ) : null}

      {/* Top HUD bar with Diagnostic Info and Stream Controls */}
      <div className="absolute left-3 top-3 right-3 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-3 py-1 font-mono text-xs text-white border border-white/10 shadow-sm">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              hud.status === 'TRACKING'
                ? 'bg-emerald-400 animate-pulse'
                : hud.status === 'RUNNING'
                  ? 'bg-amber-400'
                  : 'bg-muted-foreground',
            )}
          />
          <span className="font-semibold text-xs tracking-wide">
            {hud.status}
          </span>
          {hud.fps > 0 ? (
            <span className="text-white/60 text-[11px] border-l border-white/20 pl-1.5">
              {hud.fps} FPS
            </span>
          ) : null}
        </div>

        {running ? (
          <div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md p-1 border border-white/10 shadow-sm">
            <button
              type="button"
              onClick={onMirrorToggle}
              title={mirrorOn ? 'Mirror view: ON' : 'Mirror view: OFF'}
              className={cn(
                'rounded-full p-1.5 text-xs text-white/90 hover:bg-white/20 transition',
                mirrorOn ? 'text-primary' : 'text-white/60',
              )}
            >
              <FlipHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setGuideOn(!guideOn)}
              title={guideOn ? 'Hide alignment guide' : 'Show alignment guide'}
              className="rounded-full p-1.5 text-xs text-white/90 hover:bg-white/20 transition"
            >
              {guideOn ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-white/60" />}
            </button>
            <button
              type="button"
              onClick={() => setBrightMode(!brightMode)}
              title={brightMode ? 'Studio lighting boost: ON' : 'Studio lighting boost: OFF'}
              className={cn(
                'rounded-full p-1.5 text-xs hover:bg-white/20 transition',
                brightMode ? 'text-primary' : 'text-white/60',
              )}
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onFlip}
              title="Flip camera front/back"
              className="rounded-full p-1.5 text-xs text-white/90 hover:bg-white/20 transition"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Start Camera Hero Prompt if idle */}
      {!running ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-gradient-to-t from-black via-black/80 to-black/60 p-6 text-center text-white">
          <div className="rounded-full bg-primary/20 p-4 ring-8 ring-primary/10">
            <Sparkles className="h-10 w-10 text-primary animate-pulse" />
          </div>
          <div>
            <h3 className="font-serif text-2xl font-semibold tracking-wide">Studio Virtual Mirror</h3>
            <p className="mt-2 max-w-xs text-sm text-white/70 leading-relaxed">{promptText}</p>
          </div>
          <Button
            size="lg"
            onClick={onStart}
            disabled={starting}
            className="rounded-full px-8 py-6 font-medium shadow-xl shadow-primary/20 hover:scale-105 transition-transform"
          >
            <Camera className="mr-2 h-5 w-5" />
            {starting ? 'Calibrating Camera…' : 'Open Virtual Studio'}
          </Button>
          <p className="text-[11px] text-white/50">Private & Secure · Video is processed strictly on your device</p>
        </div>
      ) : null}

      {/* In-view Bottom Shutter Bar */}
      {running ? (
        <div className="absolute bottom-4 left-0 right-0 z-20 flex items-center justify-center gap-4 px-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStop}
            className="rounded-full bg-black/60 text-white hover:bg-black/80 border-white/20 text-xs backdrop-blur-md"
          >
            Close Camera
          </Button>

          {/* Shutter Button */}
          <button
            type="button"
            onClick={triggerShutter}
            disabled={captureDisabled || countdown !== null}
            title="Take Studio Snapshot"
            className="group relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-primary shadow-xl hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-50"
          >
            <div className="h-11 w-11 rounded-full bg-white transition group-hover:bg-primary-foreground" />
            <Camera className="absolute h-5 w-5 text-primary group-hover:text-white transition" />
          </button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={triggerShutter}
            disabled={captureDisabled || countdown !== null}
            className="rounded-full bg-black/60 text-white hover:bg-black/80 border-white/20 text-xs backdrop-blur-md"
          >
            Capture
          </Button>
        </div>
      ) : null}

      {/* Error banner if camera fails */}
      {hud.error ? (
        <div className="absolute bottom-20 left-4 right-4 z-30 rounded-xl border border-destructive/50 bg-destructive/90 p-3 text-center text-xs text-white backdrop-blur-md flex items-center justify-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{hud.error}</span>
        </div>
      ) : null}
    </div>
  );
}
