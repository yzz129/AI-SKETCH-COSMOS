import { Canvas } from '@react-three/fiber';
import type { PointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { startRemoteModelControlReceiver, subscribeToDisplayAdminCommands } from '../../lib/artwork/modelControlSync';
import { clearLocalArtworkStressTest, runLocalArtworkStressTest } from '../../lib/artwork/localStressTest';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { Effects } from './Effects';
import { Scene } from './Scene';
import { DISPLAY_COMPOSITION_OFFSET_X } from './cosmicAnchors';
import {
  ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY,
  MAX_VARIABLE_DISPLAY_MODELS,
  normalizeVariableModelLimit,
  reduceVariableModelLimit
} from './displayModelPolicy';

export function WebGLCanvas() {
  const contextRecoveryTimerRef = useRef<number | null>(null);
  const beginCollapse = useSketchStore((state) => state.beginCollapse);
  const updateCollapseCenter = useSketchStore((state) => state.updateCollapseCenter);
  const endCollapse = useSketchStore((state) => state.endCollapse);
  useEffect(() => {
    window.addEventListener('pointerup', endCollapse);
    window.addEventListener('pointercancel', endCollapse);
    window.addEventListener('blur', endCollapse);

    return () => {
      window.removeEventListener('pointerup', endCollapse);
      window.removeEventListener('pointercancel', endCollapse);
      window.removeEventListener('blur', endCollapse);
    };
  }, [endCollapse]);

  useEffect(() => startRemoteModelControlReceiver(), []);

  useEffect(() => () => {
    if (contextRecoveryTimerRef.current !== null) {
      window.clearTimeout(contextRecoveryTimerRef.current);
    }
  }, []);

  useEffect(() => subscribeToDisplayAdminCommands((message) => {
    if (message.command === 'clear-artworks') {
      useArtworkStore.getState().clearArtworks();
      useSketchStore.setState({ status: 'idle', message: '星河已清空。' });
      return;
    }
    if (message.command === 'stress-start') {
      runLocalArtworkStressTest(message.target);
      return;
    }
    if (message.command === 'stress-clear') {
      clearLocalArtworkStressTest();
      return;
    }
    if (message.command === 'toggle-fullscreen') {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => {
          document.documentElement.classList.toggle('display-focus-mode');
        });
      } else {
        void document.exitFullscreen();
      }
    }
  }), []);

  const pointToCollapseCenter = (event: PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
    return [
      Math.min(1, Math.max(0, x)),
      Math.min(1, Math.max(0, y))
    ];
  };

  const isPanelEvent = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    return target instanceof HTMLElement && Boolean(target.closest('.cosmic-panel, .cosmic-panel-compact, .cosmic-panel-toggle, .upload-panel'));
  };

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isPanelEvent(event)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginCollapse(pointToCollapseCenter(event));
  };

  const handleStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isPanelEvent(event) || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateCollapseCenter(pointToCollapseCenter(event));
  };

  const handleStagePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endCollapse();
  };

  return (
    <div
      className="webgl-stage"
      onPointerDown={handleStagePointerDown}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerUp}
      onPointerCancel={handleStagePointerUp}
      onLostPointerCapture={endCollapse}
    >
      <Canvas
        className="webgl-canvas"
        camera={{ position: [DISPLAY_COMPOSITION_OFFSET_X, 0, 6], fov: 50, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
          // Avoid copying the full 4K back buffer after every frame. Keeping it
          // preserved increases compositor pressure and can worsen flashes.
          preserveDrawingBuffer: false,
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            console.warn('[cosmos] WebGL context lost — pausing render');
            if (contextRecoveryTimerRef.current !== null) {
              window.clearTimeout(contextRecoveryTimerRef.current);
            }
            contextRecoveryTimerRef.current = window.setTimeout(() => {
              // Keep native rendering quality. If the display GPU cannot
              // restore its context, reduce only the dynamic model budget and
              // rebuild the scene; the 23 award models remain prioritized.
              try {
                const stored = window.sessionStorage.getItem(
                  ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY
                );
                const currentLimit = stored === null
                  ? MAX_VARIABLE_DISPLAY_MODELS
                  : normalizeVariableModelLimit(Number(stored));
                window.sessionStorage.setItem(
                  ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY,
                  String(reduceVariableModelLimit(currentLimit))
                );
              } catch {
                // Storage can be unavailable in hardened display browsers;
                // reloading still gives WebGL a fresh context in that case.
              }
              window.location.reload();
            }, 8_000);
          });
          canvas.addEventListener('webglcontextrestored', () => {
            if (contextRecoveryTimerRef.current !== null) {
              window.clearTimeout(contextRecoveryTimerRef.current);
              contextRecoveryTimerRef.current = null;
            }
            console.log('[cosmos] WebGL context restored — resuming');
          });
        }}
      >
        <color attach="background" args={['#03010d']} />
        <fog attach="fog" args={['#08051a', 10, 34]} />
        <Scene />
        <Effects />
      </Canvas>
    </div>
  );
}
