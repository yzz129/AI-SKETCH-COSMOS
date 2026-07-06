import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SplatMesh as SparkSplatMesh } from '@sparkjsdev/spark';

type SplatCreatureModelProps = {
  url: string;
  colors: string[];
  scale?: number;
  onReady?: () => void;
  onError?: (error: unknown) => void;
};

export function SplatCreatureModel({
  url,
  colors,
  scale = 0.58,
  onReady,
  onError
}: SplatCreatureModelProps) {
  const meshRef = useRef<SparkSplatMesh | null>(null);
  const baseScaleRef = useRef(scale);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [failed, setFailed] = useState(false);
  const [splat, setSplat] = useState<SparkSplatMesh | null>(null);
  const glowColor = useMemo(() => new THREE.Color(colors[1] ?? colors[0] ?? '#64d9ff'), [colors]);

  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onError, onReady]);

  useEffect(() => {
    let disposed = false;
    let loadedMesh: SparkSplatMesh | null = null;
    setFailed(false);
    setSplat(null);
    meshRef.current = null;

    import('@sparkjsdev/spark')
      .then(({ SplatMesh }) => {
        if (disposed) return;
        const mesh = new SplatMesh({
          url,
          onLoad: (loaded) => {
            if (disposed || meshRef.current !== loaded) return;
            baseScaleRef.current = normalizeSplatMesh(loaded, scale);
            onReadyRef.current?.();
          }
        });

        loadedMesh = mesh;
        meshRef.current = mesh;
        mesh.visible = true;
        setSplat(mesh);

        mesh.initialized
          .then((initializedMesh) => {
            if (disposed || meshRef.current !== initializedMesh) return;
            baseScaleRef.current = normalizeSplatMesh(initializedMesh, scale);
            onReadyRef.current?.();
          })
          .catch((error) => {
            if (disposed || meshRef.current !== mesh) return;
            setFailed(true);
            onErrorRef.current?.(error);
          });
      })
      .catch((error) => {
        if (disposed) return;
        setFailed(true);
        onErrorRef.current?.(error);
      });

    return () => {
      disposed = true;
      meshRef.current = null;
      loadedMesh?.dispose();
    };
  }, [scale, url]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || failed) return;

    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 1.12) * 0.035;
    mesh.scale.setScalar(baseScaleRef.current * breath);
    mesh.rotation.y = Math.sin(t * 0.46) * 0.12;
    mesh.rotation.x = Math.sin(t * 0.32) * 0.04;
    mesh.recolor.copy(glowColor);
    mesh.opacity = 0.96;
  });

  if (failed || !splat) return null;
  return <primitive object={splat} />;
}

function normalizeSplatMesh(mesh: SparkSplatMesh, scale: number) {
  const box = mesh.getBoundingBox(true);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  let normalizedScale = scale;
  if (Number.isFinite(maxDimension) && maxDimension > 0.0001) {
    mesh.position.sub(center);
    normalizedScale = scale / maxDimension;
    mesh.scale.setScalar(normalizedScale);
  } else {
    mesh.scale.setScalar(scale);
  }

  mesh.quaternion.set(1, 0, 0, 0);
  mesh.frustumCulled = false;
  return normalizedScale;
}
