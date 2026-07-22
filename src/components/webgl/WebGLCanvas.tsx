import { Canvas } from '@react-three/fiber';
import type { PointerEvent } from 'react';
import { useEffect } from 'react';
import { startRemoteModelControlReceiver } from '../../lib/artwork/modelControlSync';
import { useSketchStore } from '../../stores/useSketchStore';
import { CosmicControlPanel } from '../ui/CosmicControlPanel';
import { TouchTrailCanvas } from '../ui/TouchTrailCanvas';
import { Effects } from './Effects';
import { Scene } from './Scene';

export function WebGLCanvas() {
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
    if (isPanelEvent(event)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    beginCollapse(pointToCollapseCenter(event));
  };

  const handleStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isPanelEvent(event) || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

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
        camera={{ position: [0, 0, 6], fov: 50, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false,
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            console.warn('[cosmos] WebGL context lost — pausing render');
          });
          canvas.addEventListener('webglcontextrestored', () => {
            console.log('[cosmos] WebGL context restored — resuming');
          });
        }}
      >
        <color attach="background" args={['#03010d']} />
        <fog attach="fog" args={['#08051a', 10, 34]} />
        <Scene />
        <Effects />
      </Canvas>
      <TouchTrailCanvas />
      <CosmicControlPanel />
    </div>
  );
}
