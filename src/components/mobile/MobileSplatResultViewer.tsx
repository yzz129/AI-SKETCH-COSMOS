import { OrbitControls, Stars } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { StoredArtwork } from '../../stores/artworkStore';
import { SplatCreatureModel } from '../webgl/SplatCreatureModel';

export type MobileSplatResultViewerHandle = {
  capture: () => Promise<Blob | null>;
};

type MobileSplatResultViewerProps = {
  artwork: StoredArtwork;
  onReady?: () => void;
};

export const MobileSplatResultViewer = forwardRef<
  MobileSplatResultViewerHandle,
  MobileSplatResultViewerProps
>(function MobileSplatResultViewer({ artwork, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const model = artwork.gaussianModel;

  useImperativeHandle(ref, () => ({
    capture: () => new Promise<Blob | null>((resolve) => {
      if (!canvasRef.current || state !== 'ready') {
        resolve(null);
        return;
      }
      canvasRef.current.toBlob(resolve, 'image/png');
    })
  }), [state]);

  if (!model?.splatUrl) {
    return (
      <div className="mobile-splat-viewer__fallback">
        <p>当前任务没有返回可浏览的 .splat 模型。</p>
      </div>
    );
  }

  return (
    <div className="mobile-splat-viewer" data-state={state}>
      <Canvas
        camera={{ position: [0, 0.12, 4.4], fov: 42, near: 0.01, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ alpha: false, antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
          gl.setClearColor('#020719', 1);
        }}
      >
        <Stars radius={20} depth={10} count={260} factor={1.5} saturation={0.2} fade speed={0.35} />
        <SplatCreatureModel
          url={model.splatUrl}
          rigUrl={model.rigUrl}
          colors={artwork.features.visualTraits.dominantColors}
          features={artwork.features}
          scale={2.45}
          allowDistanceCulling={false}
          onReady={() => {
            setState('ready');
            onReady?.();
          }}
          onError={() => setState('error')}
        />
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.6}
          maxDistance={7}
          autoRotate={state === 'ready'}
          autoRotateSpeed={0.55}
        />
      </Canvas>

      {state === 'loading' ? (
        <div className="mobile-splat-viewer__overlay" aria-live="polite">
          <span className="mobile-splat-viewer__loader" aria-hidden="true" />
          <p>正在把真实 3D 模型装进手机…</p>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="mobile-splat-viewer__overlay mobile-splat-viewer__overlay--error" role="alert">
          <p>模型载入失败，可以下载模型后在支持 Gaussian Splat 的设备中查看。</p>
        </div>
      ) : null}
      {state === 'ready' ? (
        <div className="mobile-splat-viewer__hint" aria-hidden="true">
          <span>拖动旋转</span>
          <i />
          <span>双指缩放</span>
        </div>
      ) : null}
    </div>
  );
});
