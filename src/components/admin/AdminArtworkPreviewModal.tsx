import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ArtworkFeatureResult } from '../../types/artwork';
import { SplatCreatureModel } from '../webgl/SplatCreatureModel';

const FALLBACK_FEATURES: ArtworkFeatureResult = {
  subjectCategory: 'abstract',
  morphology: {
    hasWings: false,
    wingCount: 0,
    hasLegs: false,
    legCount: 0,
    hasTail: false,
    hasFins: false,
    hasArms: false,
    hasHead: false,
    bodyOrientation: 'floating',
    silhouetteComplexity: 'medium'
  },
  behaviorTraits: { locomotionType: 'floating', energyLevel: 'gentle', personalityFeel: 'dreamy' },
  visualTraits: { dominantColors: ['#60a5fa', '#f59e0b'], brightness: 'medium', softness: 'normal', textureStyle: 'mixed' },
  motionPreset: 'spiritFloat'
};

type AdminArtworkPreviewModalProps = {
  name: string;
  splatUrl: string;
  features?: ArtworkFeatureResult | null;
  onClose: () => void;
};

export function AdminArtworkPreviewModal({ name, splatUrl, features, onClose }: AdminArtworkPreviewModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="admin-preview-modal" role="dialog" aria-modal="true" aria-label={`${name} 3D 模型预览`} onMouseDown={onClose}>
      <section className="admin-preview-modal__panel" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>用户模型预览</span><strong>{name}</strong></div>
          <button type="button" onClick={onClose} aria-label="关闭预览"><X size={20} /></button>
        </header>
        <div className="admin-preview-modal__canvas">
          <Canvas camera={{ position: [0, 0, 3.2], fov: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}>
            <color attach="background" args={['#111827']} />
            <ambientLight intensity={1.4} />
            <Suspense fallback={null}>
              <SplatCreatureModel
                url={splatUrl}
                colors={features?.visualTraits.dominantColors ?? FALLBACK_FEATURES.visualTraits.dominantColors}
                features={features ?? FALLBACK_FEATURES}
                scale={1.45}
                allowDistanceCulling={false}
                loadPriority={-100}
                onReady={() => setStatus('ready')}
                onError={() => setStatus('error')}
              />
            </Suspense>
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              enablePan={false}
              minDistance={1.25}
              maxDistance={7}
              autoRotate={status === 'ready'}
              autoRotateSpeed={0.75}
            />
          </Canvas>
          {status !== 'ready' ? (
            <div className={`admin-preview-modal__status ${status === 'error' ? 'is-error' : ''}`}>
              {status === 'error' ? '模型预览加载失败，请检查资源文件。' : '正在加载用户 3D 模型…'}
            </div>
          ) : null}
        </div>
        <footer>拖动旋转模型 · 滚轮缩放 · 按 Esc 或点击外部关闭</footer>
      </section>
    </div>
  );
}
