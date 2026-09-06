import { Bounds, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

class DesignerPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div className="designer-preview-message">模型预览加载失败，可先下载 GLB 后查看。</div>;
    }
    return this.props.children;
  }
}

function disposeScene(scene: THREE.Object3D) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

function parseGlb(buffer: ArrayBuffer) {
  return new Promise<THREE.Group>((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => {
        gltf.scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.frustumCulled = true;
        });
        resolve(gltf.scene);
      },
      reject
    );
  });
}

export function DesignerGlbPreview({ url, name }: { url: string; name: string }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let parsedScene: THREE.Group | null = null;
    setScene(null);
    setProgress(0);
    setLoadError('');

    void (async () => {
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`模型文件请求失败（${response.status}）`);
        const total = Number(response.headers.get('content-length') || 0);
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              loaded += value.byteLength;
              setProgress(total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 50);
            }
          }
        }
        let buffer: ArrayBuffer;
        if (reader) {
          const combined = new Uint8Array(loaded);
          let offset = 0;
          chunks.forEach((chunk) => {
            combined.set(chunk, offset);
            offset += chunk.byteLength;
          });
          buffer = combined.buffer;
        } else {
          buffer = await response.arrayBuffer();
        }
        const signature = new TextDecoder().decode(buffer.slice(0, 4));
        if (signature !== 'glTF') throw new Error('服务器返回的文件不是有效 GLB');
        parsedScene = await parseGlb(buffer);
        if (controller.signal.aborted) {
          disposeScene(parsedScene);
          return;
        }
        setProgress(100);
        setScene(parsedScene);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : '模型加载失败');
        }
      }
    })();

    return () => {
      controller.abort();
      if (parsedScene) disposeScene(parsedScene);
    };
  }, [url]);

  return (
    <div className="designer-glb-preview" aria-label={`${name} GLB 模型预览`}>
      {scene ? (
        <DesignerPreviewBoundary key={url}>
          <Canvas
            camera={{ position: [0, 0.2, 3.8], fov: 36, near: 0.01, far: 100 }}
            dpr={[1, 1.5]}
            fallback={<div className="designer-preview-message">当前浏览器无法显示 3D，可复制下载链接后在浏览器查看。</div>}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          >
            <ambientLight intensity={1.8} />
            <hemisphereLight args={['#ffffff', '#a8b9d8', 1.7]} />
            <directionalLight position={[4, 6, 5]} intensity={3.2} color="#fff7ea" castShadow={false} />
            <directionalLight position={[-4, 1, 3]} intensity={1.4} color="#c6d8ff" />
            <Bounds fit clip observe margin={1.25}>
              <primitive object={scene} />
            </Bounds>
            <OrbitControls
              ref={controlsRef}
              makeDefault
              autoRotate={false}
              enableDamping
              dampingFactor={0.08}
              enablePan
              panSpeed={0.75}
              rotateSpeed={0.8}
              zoomSpeed={0.9}
              minDistance={1.6}
              maxDistance={7}
              minPolarAngle={0}
              maxPolarAngle={Math.PI}
            />
          </Canvas>
        </DesignerPreviewBoundary>
      ) : (
        <div className={`designer-preview-message${loadError ? ' is-error' : ''}`} role="status">
          {loadError || `正在加载模型 ${progress}%`}
        </div>
      )}
      <div className="designer-preview-tools">
        <button type="button" onClick={() => controlsRef.current?.reset()}>复位视角</button>
        <span>左键/单指旋转 · 右键/双指平移 · 滚轮/捏合缩放</span>
      </div>
    </div>
  );
}
