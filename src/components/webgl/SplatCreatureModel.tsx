import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SplatMesh as SparkSplatMesh } from '@sparkjsdev/spark';

type SplatCreatureModelProps = {
  url: string;
  colors: string[];
  scale?: number;
  spotlightFocusRef?: RefObject<number>;
  burstRef?: MutableRefObject<number>;
  onReady?: () => void;
  onError?: (error: unknown) => void;
};

type SplatParticleProxy = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

export function SplatCreatureModel({
  url,
  colors,
  scale = 0.58,
  spotlightFocusRef,
  burstRef,
  onReady,
  onError
}: SplatCreatureModelProps) {
  const meshRef = useRef<SparkSplatMesh | null>(null);
  const particleProxyRef = useRef<THREE.Points>(null);
  const baseScaleRef = useRef(scale);
  const showcaseSpinRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [failed, setFailed] = useState(false);
  const [splat, setSplat] = useState<SparkSplatMesh | null>(null);
  const [particleProxy, setParticleProxy] = useState<SplatParticleProxy | null>(null);
  const rainbowGlow = useMemo(() => [
    new THREE.Color('#ff4d4d'),
    new THREE.Color('#ff9a2f'),
    new THREE.Color('#fff04a'),
    new THREE.Color('#52ff89'),
    new THREE.Color('#55a7ff'),
    new THREE.Color('#c86bff')
  ], []);
  const motionPhase = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < url.length; i += 1) {
      hash = (hash * 31 + url.charCodeAt(i)) | 0;
    }
    return Math.abs(hash % 10_000) / 10_000 * Math.PI * 2;
  }, [url]);

  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onError, onReady]);

  useEffect(() => {
    let disposed = false;
    let loadedMesh: SparkSplatMesh | null = null;
    setFailed(false);
    setSplat(null);
    setParticleProxy((proxy) => {
      proxy?.geometry.dispose();
      proxy?.material.dispose();
      return null;
    });
    meshRef.current = null;

    import('@sparkjsdev/spark')
      .then(({ SplatMesh }) => {
        if (disposed) return;
        const mesh = new SplatMesh({
          url,
          onLoad: (loaded) => {
            if (disposed || meshRef.current !== loaded) return;
            baseScaleRef.current = normalizeSplatMesh(loaded, scale);
            setParticleProxy((proxy) => {
              proxy?.geometry.dispose();
              proxy?.material.dispose();
              return createSplatParticleProxy(loaded, motionPhase);
            });
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
            setParticleProxy((proxy) => {
              proxy?.geometry.dispose();
              proxy?.material.dispose();
              return createSplatParticleProxy(initializedMesh, motionPhase);
            });
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
      setParticleProxy((proxy) => {
        proxy?.geometry.dispose();
        proxy?.material.dispose();
        return null;
      });
    };
  }, [motionPhase, scale, url]);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh || failed) return;

    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 0.52) * 0.018;
    const focus = spotlightFocusRef?.current ?? 0;
    const freeMotion = 1 - focus;
    const burst = burstRef?.current ?? 0;
    const burstShock = THREE.MathUtils.smoothstep(burst, 0, 1);
    const isBursting = burst > 0.004;
    const burstShake = Math.sin(t * 28 + motionPhase) * burstShock;
    showcaseSpinRef.current += delta * THREE.MathUtils.lerp(0.42, 0.86, focus);
    const freeYaw = (
      Math.sin(t * 0.34 + motionPhase) * 0.16 +
      Math.sin(t * 0.11 + motionPhase * 0.7) * 0.07
    ) * freeMotion;
    const freePitch = Math.sin(t * 0.26 + motionPhase * 1.3) * 0.038 * freeMotion;
    const freeRoll = Math.sin(t * 0.43 + motionPhase * 0.9) * 0.052 * freeMotion;
    const twist = Math.sin(t * 0.58 + motionPhase) * freeMotion;
    const tailSwing = Math.sin(t * 1.18 + motionPhase * 1.7) * freeMotion;
    const baseScale = baseScaleRef.current * breath;
    const glowPhase = (t * 0.42 + motionPhase) % rainbowGlow.length;
    const glowIndex = Math.floor(glowPhase);
    const nextGlowIndex = (glowIndex + 1) % rainbowGlow.length;
    const surfaceGlowColor = rainbowGlow[glowIndex].clone().lerp(
      rainbowGlow[nextGlowIndex],
      glowPhase - glowIndex
    );

    const burstScale = 1 + burstShock * 0.055;
    mesh.scale.set(
      baseScale * burstScale * (1 + twist * 0.026 + Math.max(0, tailSwing) * 0.018 + burstShake * 0.015),
      baseScale * burstScale * (1 - twist * 0.016 + Math.sin(t * 23 + motionPhase) * burstShock * 0.012),
      baseScale * burstScale * (1 + Math.sin(t * 0.37 + motionPhase) * 0.018 * freeMotion - tailSwing * 0.012)
    );
    mesh.rotation.set(
      freePitch + burstShake * 0.075,
      showcaseSpinRef.current + freeYaw + Math.sin(t * 19 + motionPhase * 0.6) * burstShock * 0.13,
      Math.PI + freeRoll + Math.sin(t * 25 + motionPhase * 1.4) * burstShock * 0.1
    );
    const glowPulse = (Math.sin(t * 1.1 + motionPhase) + 1) * 0.5;
    mesh.recolor.copy(surfaceGlowColor).lerp(
      new THREE.Color('#ffffff'),
      THREE.MathUtils.clamp(0.38 + glowPulse * 0.18 - burstShock * 0.3, 0.1, 0.62)
    );
    mesh.opacity = THREE.MathUtils.lerp(0.86, 0.97, glowPulse);
    mesh.visible = !isBursting;

    const proxy = particleProxyRef.current;
    if (proxy) {
      proxy.position.copy(mesh.position);
      proxy.rotation.copy(mesh.rotation);
      proxy.scale.copy(mesh.scale);
      proxy.visible = isBursting;
      const material = proxy.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = t;
      material.uniforms.uExplodeProgress.value = burstShock;
      material.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(burstShock, 0.01, 0.12) * 1.18;
    }
  });

  if (failed || !splat) return null;
  return (
    <group>
      <primitive object={splat} />
      {particleProxy ? (
        <points
          ref={particleProxyRef}
          geometry={particleProxy.geometry}
          material={particleProxy.material}
          renderOrder={12}
          frustumCulled={false}
        />
      ) : null}
    </group>
  );
}

function createSplatParticleProxy(mesh: SparkSplatMesh, seed: number): SplatParticleProxy {
  const box = mesh.getBoundingBox(true);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const total = Math.max(1, mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 1);
  const maxParticles = 18000;
  const stride = Math.max(1, Math.ceil(total / maxParticles));
  const sampleCount = Math.ceil(total / stride);
  const positions = new Float32Array(sampleCount * 3);
  const directions = new Float32Array(sampleCount * 3);
  const colors = new Float32Array(sampleCount * 3);
  const phases = new Float32Array(sampleCount);
  const sizes = new Float32Array(sampleCount);
  const tempDir = new THREE.Vector3();
  let cursor = 0;

  mesh.forEachSplat((index, splatCenter, _scales, _quaternion, opacity, color) => {
    if (index % stride !== 0 || cursor >= sampleCount) return;
    const i3 = cursor * 3;
    positions[i3] = splatCenter.x;
    positions[i3 + 1] = splatCenter.y;
    positions[i3 + 2] = splatCenter.z;

    const phase = seededNoise(seed, index, 1) * Math.PI * 2;
    tempDir
      .subVectors(splatCenter, center)
      .add(new THREE.Vector3(
        seededNoise(seed, index, 2) - 0.5,
        seededNoise(seed, index, 3) - 0.5,
        seededNoise(seed, index, 4) - 0.5
      ).multiplyScalar(0.08))
      .normalize();
    if (!Number.isFinite(tempDir.x)) tempDir.set(0, 1, 0);
    directions[i3] = tempDir.x;
    directions[i3 + 1] = tempDir.y;
    directions[i3 + 2] = tempDir.z;
    colors[i3] = THREE.MathUtils.clamp(color.r, 0, 1);
    colors[i3 + 1] = THREE.MathUtils.clamp(color.g, 0, 1);
    colors[i3 + 2] = THREE.MathUtils.clamp(color.b, 0, 1);
    phases[cursor] = phase;
    sizes[cursor] = THREE.MathUtils.clamp(0.011 + opacity * 0.01 + seededNoise(seed, index, 5) * 0.013, 0.009, 0.036);
    cursor += 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor * 3), 3));
  geometry.setAttribute('direction', new THREE.BufferAttribute(directions.slice(0, cursor * 3), 3));
  geometry.setAttribute('splatColor', new THREE.BufferAttribute(colors.slice(0, cursor * 3), 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases.slice(0, cursor), 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes.slice(0, cursor), 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uExplodeProgress: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uExplodeProgress;
      uniform float uOpacity;
      uniform float uPixelRatio;
      attribute vec3 direction;
      attribute vec3 splatColor;
      attribute float phase;
      attribute float size;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float progress = smoothstep(0.0, 1.0, uExplodeProgress);
        vec3 tangent = normalize(cross(direction, vec3(0.0, 1.0, 0.0)) + vec3(0.001, 0.0, 0.0));
        vec3 binormal = normalize(cross(direction, tangent));
        float wave = sin(uTime * 8.0 + phase) * 0.055 * progress;
        float radius = length(position);
        vec3 exploded = position
          + direction * (2.35 + radius * 2.05 + 0.95 * sin(phase * 1.73) * sin(phase * 1.73)) * progress
          + tangent * sin(uTime * 5.2 + phase) * 0.48 * progress
          + binormal * cos(uTime * 4.1 + phase) * 0.34 * progress
          + direction * wave * 1.8;
        vec4 mvPosition = modelViewMatrix * vec4(exploded, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * (1.0 + progress * 2.2) * 560.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = mix(max(splatColor, vec3(0.3)), vec3(0.78, 0.98, 1.0), progress * 0.18);
        vAlpha = uOpacity * (0.58 + 0.26 * sin(phase + progress * 3.14159));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = smoothstep(0.28, 0.0, d);
        float glow = smoothstep(0.5, 0.04, d) * 0.34;
        gl_FragColor = vec4(vColor, (core + glow) * vAlpha);
      }
    `
  });

  material.visible = true;
  return { geometry, material };
}

function seededNoise(seed: number, index: number, salt: number) {
  const x = Math.sin(seed * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
  return x - Math.floor(x);
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

  mesh.quaternion.identity();
  mesh.frustumCulled = false;
  return normalizedScale;
}
