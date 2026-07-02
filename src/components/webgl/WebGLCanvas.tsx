import { Canvas } from '@react-three/fiber';
import type { PointerEvent } from 'react';
import { useEffect } from 'react';
import { useSketchStore } from '../../stores/useSketchStore';
import { CosmicControlPanel } from '../ui/CosmicControlPanel';
import { Effects } from './Effects';
import { Scene } from './Scene';

export function WebGLCanvas() {
  const lastActivityAt = useSketchStore((state) => state.lastActivityAt);
  const setIdleMode = useSketchStore((state) => state.setIdleMode);
  const touchActivity = useSketchStore((state) => state.touchActivity);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityAt > 90_000) {
        setIdleMode(true);
      }
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [lastActivityAt, setIdleMode]);

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.cosmic-panel, .upload-panel')) {
      return;
    }

    touchActivity();
  };

  return (
    <div className="webgl-stage" onPointerDown={handleStagePointerDown}>
      <Canvas
        className="webgl-canvas"
        camera={{ position: [0, 0, 6], fov: 50, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance'
        }}
      >
        <color attach="background" args={['#03010d']} />
        <fog attach="fog" args={['#08051a', 10, 34]} />
        <Scene />
        <Effects />
      </Canvas>
      <CosmicControlPanel />
    </div>
  );
}
