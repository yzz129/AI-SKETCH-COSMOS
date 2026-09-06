import { Bounds, OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

type AdminGlbPreviewProps = {
  modelUrl: string;
  name: string;
};

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="admin-glb-preview__status admin-glb-preview__status--error">
          <strong>模型加载失败</strong>
          <span>请检查 GLB 文件是否存在，然后点击右上角刷新重试。</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function PreviewModel({ modelUrl }: { modelUrl: string }) {
  const gltf = useGLTF(modelUrl) as { scene: THREE.Group };
  const scene = useMemo(() => {
    const cloned = cloneSkeleton(gltf.scene);
    cloned.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => material.clone());
      } else if (mesh.material) {
        mesh.material = mesh.material.clone();
      }
    });
    return cloned;
  }, [gltf.scene]);

  return <primitive object={scene} />;
}

export function AdminGlbPreview({ modelUrl, name }: AdminGlbPreviewProps) {
  const { active, progress } = useProgress();
  return (
    <div className="admin-glb-preview" aria-label={`${name} 3D 预览`}>
      <PreviewErrorBoundary key={modelUrl}>
        <Canvas
          camera={{ position: [0, 0.15, 3.6], fov: 36, near: 0.01, far: 100 }}
          dpr={[1, 1.5]}
          frameloop="demand"
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#171b22']} />
          <ambientLight intensity={2.1} />
          <hemisphereLight args={['#ffffff', '#252a32', 1.9]} />
          <directionalLight position={[3.5, 5, 4]} intensity={3.4} color="#fff5e8" />
          <directionalLight position={[-4, 1, 2]} intensity={1.8} color="#b8c7ff" />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.25}>
              <PreviewModel modelUrl={modelUrl} />
            </Bounds>
          </Suspense>
          <gridHelper args={[8, 16, '#3b414b', '#242932']} position={[0, -1.25, 0]} />
          <OrbitControls
            makeDefault
            enableDamping={false}
            enablePan={false}
            minDistance={1.8}
            maxDistance={7}
            minPolarAngle={Math.PI * 0.18}
            maxPolarAngle={Math.PI * 0.82}
          />
        </Canvas>
      </PreviewErrorBoundary>
      {active ? (
        <div className="admin-glb-preview__status" role="status">
          <span className="admin-glb-preview__spinner" />
          <strong>正在加载模型 {Math.round(progress)}%</strong>
          <span>首次打开需要下载 GLB，之后会使用浏览器缓存。</span>
        </div>
      ) : null}
      <div className="admin-glb-preview__hint">拖动旋转 · 滚轮缩放</div>
    </div>
  );
}
