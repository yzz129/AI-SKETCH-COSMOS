import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SplatMesh as SparkSplatMesh } from '@sparkjsdev/spark';
import type { ArtworkFeatureResult } from '../../types/artwork';

type SplatCreatureModelProps = {
  url: string;
  colors: string[];
  features: ArtworkFeatureResult;
  scale?: number;
  spotlightFocusRef?: RefObject<number>;
  burstRef?: MutableRefObject<number>;
  burstPhaseRef?: MutableRefObject<number>;
  reappearRef?: MutableRefObject<number>;
  flightWorldPositionRef?: MutableRefObject<THREE.Vector3>;
  flightOpacityRef?: MutableRefObject<number>;
  onReady?: () => void;
  onError?: (error: unknown) => void;
};

type SplatParticleProxy = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

type SplatCpuDeformer = {
  indices: Uint32Array;
  centers: Float32Array;
  scales: Float32Array;
  quaternions: Float32Array;
  opacities: Float32Array;
  colors: Float32Array;
  shape: Float32Array;
  maxDimension: number;
  lastUpdate: number;
  cursor: number;
  restoreCursor: number;
  isDeformed: boolean;
  center: THREE.Vector3;
  scale: THREE.Vector3;
  quaternion: THREE.Quaternion;
  color: THREE.Color;
};

const CPU_DEFORM_HZ = 18;
const CPU_DEFORM_NEAR_DISTANCE = 11;
const CPU_DEFORM_FOCUS_DISTANCE = 15;
const CPU_DEFORM_FRAME_BUDGET = Number.POSITIVE_INFINITY;
const CPU_DEFORM_ACTIVE_SECONDS = 10;
const CPU_DEFORM_REST_SECONDS = 3;
const CPU_DEFORM_MAX_ACTIVE_MODELS = 10;
let cpuDeformBudgetFrame = -1;
let cpuDeformBudgetUsed = 0;
const cpuDeformActiveSlots = new Map<string, number>();
const cpuDeformRestUntil = new Map<string, number>();

export function SplatCreatureModel({
  url,
  colors,
  features,
  scale = 0.58,
  spotlightFocusRef,
  burstRef,
  burstPhaseRef,
  reappearRef,
  flightWorldPositionRef,
  flightOpacityRef,
  onReady,
  onError
}: SplatCreatureModelProps) {
  const meshRef = useRef<SparkSplatMesh | null>(null);
  const particleProxyGroupRef = useRef<THREE.Group>(null);
  const particleProxyRef = useRef<THREE.Points>(null);
  const cpuDeformerRef = useRef<SplatCpuDeformer | null>(null);
  const baseScaleRef = useRef(scale);
  const basePositionRef = useRef(new THREE.Vector3());
  const flightLocalPositionRef = useRef(new THREE.Vector3());
  const cameraDistancePositionRef = useRef(new THREE.Vector3());
  const showcaseSpinRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const cpuScheduleId = useMemo(() => `splat-${Math.abs(hashString(url))}`, [url]);
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
    hash = hashString(url);
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
    cpuDeformerRef.current = null;

    import('@sparkjsdev/spark')
      .then(({ SplatMesh }) => {
        if (disposed) return;
        const mesh = new SplatMesh({
          url,
          onLoad: (loaded) => {
            if (disposed || meshRef.current !== loaded) return;
            baseScaleRef.current = normalizeSplatMesh(loaded, scale);
            basePositionRef.current.copy(loaded.position);
            cpuDeformerRef.current = createSplatCpuDeformer(loaded, features);
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
            basePositionRef.current.copy(initializedMesh.position);
            cpuDeformerRef.current = createSplatCpuDeformer(initializedMesh, features);
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
      cpuDeformerRef.current = null;
      loadedMesh?.dispose();
      setParticleProxy((proxy) => {
        proxy?.geometry.dispose();
        proxy?.material.dispose();
        return null;
      });
    };
  }, [colors, features, motionPhase, scale, url]);

  useFrame(({ clock, camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh || failed) return;

    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 0.52) * 0.018;
    const focus = spotlightFocusRef?.current ?? 0;
    const freeMotion = 1 - focus;
    const burst = burstRef?.current ?? 0;
    const burstPhase = burstPhaseRef?.current ?? (burst > 0 ? 0.5 : 1);
    const reappear = reappearRef?.current ?? 1;
    const flightOpacity = flightOpacityRef?.current ?? 0;
    const flightWorldPosition = flightWorldPositionRef?.current;
    const burstShock = THREE.MathUtils.smoothstep(burst, 0, 1);
    const isBursting = burstPhase < 0.995;
    const showFlightModel = flightOpacity > 0.01;
    const burstShake = Math.sin(t * 28 + motionPhase) * burstShock;
    showcaseSpinRef.current += delta * THREE.MathUtils.lerp(0.42, 0.1, focus);
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
    mesh.position.copy(basePositionRef.current);
    if (flightWorldPosition && flightOpacity > 0.001) {
      flightLocalPositionRef.current.copy(flightWorldPosition);
      mesh.parent?.worldToLocal(flightLocalPositionRef.current);
      mesh.position.copy(flightLocalPositionRef.current).add(basePositionRef.current);
    }
    const distanceToCamera = mesh.getWorldPosition(cameraDistancePositionRef.current).distanceTo(camera.position);
    const distanceCulled = distanceToCamera > 28 && !showFlightModel && !isBursting;
    mesh.opacity = THREE.MathUtils.lerp(0.86, 0.97, glowPulse) * Math.max(reappear, flightOpacity);
    mesh.visible = (!isBursting || showFlightModel) && !distanceCulled;

    const deformer = cpuDeformerRef.current;
    if (deformer) {
      const canUseCpuSlot = reserveCpuDeformModelSlot(cpuScheduleId, t);
      const deformDistance = THREE.MathUtils.lerp(CPU_DEFORM_NEAR_DISTANCE, CPU_DEFORM_FOCUS_DISTANCE, focus);
      const cpuDeformActive = mesh.visible
        && !isBursting
        && canUseCpuSlot
        && distanceToCamera < deformDistance
        && Math.max(reappear, flightOpacity) > 0.2;
      if (cpuDeformActive) {
        const deformEnergy = (0.62 + freeMotion * 0.38 + focus * 0.18) * (1 - burstShock);
        updateSplatCpuDeformation(mesh, deformer, t, deformEnergy);
      } else if (deformer.isDeformed) {
        restoreSplatCpuDeformation(mesh, deformer);
      }
    }

    const proxyGroup = particleProxyGroupRef.current;
    const proxyPoints = particleProxyRef.current;
    if (proxyGroup && proxyPoints) {
      proxyGroup.position.copy(basePositionRef.current);
      proxyGroup.rotation.copy(mesh.rotation);
      proxyGroup.scale.copy(mesh.scale).multiplyScalar(0.9);
      proxyGroup.visible = isBursting && !distanceCulled;
      const material = proxyPoints.material as THREE.ShaderMaterial | undefined;
      if (!material?.uniforms) return;
      material.uniforms.uTime.value = t;
      material.uniforms.uExplodeProgress.value = burstPhase;
      material.uniforms.uShock.value = burstShock;
      material.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(burstPhase, 0.01, 0.16)
        * (1 - THREE.MathUtils.smoothstep(burstPhase, 0.74, 1.0))
        * 1.32;
    }

  });

  if (failed || !splat) return null;
  return (
    <group>
      <primitive object={splat} />
      {particleProxy ? (
        <group ref={particleProxyGroupRef} visible={false}>
          <points
            ref={particleProxyRef}
            geometry={particleProxy.geometry}
            material={particleProxy.material}
            renderOrder={13}
            frustumCulled
          />
        </group>
      ) : null}
    </group>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function reserveCpuDeformModelSlot(id: string, time: number) {
  for (const [activeId, activeUntil] of cpuDeformActiveSlots) {
    if (activeUntil <= time) {
      cpuDeformActiveSlots.delete(activeId);
      cpuDeformRestUntil.set(activeId, time + CPU_DEFORM_REST_SECONDS);
    }
  }

  const activeUntil = cpuDeformActiveSlots.get(id);
  if (activeUntil && activeUntil > time) {
    return true;
  }

  const restUntil = cpuDeformRestUntil.get(id);
  if (restUntil && restUntil > time) return false;
  if (restUntil && restUntil <= time) cpuDeformRestUntil.delete(id);

  if (cpuDeformActiveSlots.size >= CPU_DEFORM_MAX_ACTIVE_MODELS) return false;

  cpuDeformActiveSlots.set(id, time + CPU_DEFORM_ACTIVE_SECONDS);
  return true;
}

function resetCpuDeformBudget(time: number) {
  const frame = Math.floor(time * 60);
  if (frame !== cpuDeformBudgetFrame) {
    cpuDeformBudgetFrame = frame;
    cpuDeformBudgetUsed = 0;
  }
}

function reserveCpuDeformWrites(time: number, requested: number) {
  resetCpuDeformBudget(time);
  const remaining = Math.max(0, CPU_DEFORM_FRAME_BUDGET - cpuDeformBudgetUsed);
  const granted = Math.min(requested, remaining);
  cpuDeformBudgetUsed += granted;
  return granted;
}

function characteristicFeatureMask(
  features: ArtworkFeatureResult,
  nx: number,
  ny: number,
  _nz: number,
  radial: number,
  edge: number
) {
  const { morphology, behaviorTraits, motionPreset, subjectCategory } = features;
  const absX = Math.abs(nx);
  const absY = Math.abs(ny);
  const side = THREE.MathUtils.smoothstep(absX, 0.42, 0.98);
  const top = THREE.MathUtils.smoothstep(ny, 0.28, 0.96);
  const bottom = THREE.MathUtils.smoothstep(-ny, 0.2, 0.92);
  const outer = Math.max(THREE.MathUtils.smoothstep(radial, 0.58, 1.22), edge * 0.72);

  if (morphology.hasWings || motionPreset.includes('Fly') || motionPreset.includes('bird') || motionPreset.includes('Flutter')) {
    return side * (0.45 + top * 0.55);
  }

  if (
    morphology.hasTail ||
    morphology.hasFins ||
    behaviorTraits.locomotionType === 'swimming' ||
    motionPreset.includes('fish') ||
    motionPreset.includes('eel') ||
    motionPreset.includes('dolphin') ||
    motionPreset.includes('squid')
  ) {
    return Math.max(side, outer) * (0.55 + THREE.MathUtils.smoothstep(absY, 0.05, 0.72) * 0.25);
  }

  if (morphology.hasLegs || behaviorTraits.locomotionType === 'walking' || behaviorTraits.locomotionType === 'running') {
    return bottom * (0.35 + side * 0.65);
  }

  if (morphology.hasArms) {
    return side * (1 - THREE.MathUtils.smoothstep(absY, 0.88, 1.18));
  }

  if (subjectCategory === 'plant' || behaviorTraits.locomotionType === 'growing' || behaviorTraits.locomotionType === 'swaying') {
    return Math.max(top, outer * 0.72);
  }

  if (morphology.hasHead || subjectCategory === 'character') {
    return top * (0.55 + outer * 0.45);
  }

  return outer;
}

function createSplatCpuDeformer(mesh: SparkSplatMesh, features: ArtworkFeatureResult): SplatCpuDeformer | null {
  if (!mesh.packedSplats?.setSplat) return null;

  const total = Math.max(1, mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0);
  if (!total) return null;

  const box = mesh.getBoundingBox(true);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const safeSize = new THREE.Vector3(
    Math.max(size.x, 0.0001),
    Math.max(size.y, 0.0001),
    Math.max(size.z, 0.0001)
  );
  const maxDimension = Math.max(safeSize.x, safeSize.y, safeSize.z, 0.0001);
  const stride = 1;
  const targetCount = total;
  const indices = new Uint32Array(targetCount);
  const centers = new Float32Array(targetCount * 3);
  const scales = new Float32Array(targetCount * 3);
  const quaternions = new Float32Array(targetCount * 4);
  const opacities = new Float32Array(targetCount);
  const colors = new Float32Array(targetCount * 3);
  const shape = new Float32Array(targetCount * 4);
  let cursor = 0;

  mesh.forEachSplat((index, splatCenter, splatScale, splatQuaternion, opacity, splatColor) => {
    if (index % stride !== 0 || cursor >= targetCount) return;
    const i3 = cursor * 3;
    const i4 = cursor * 4;
    const nx = THREE.MathUtils.clamp((splatCenter.x - center.x) / (safeSize.x * 0.5), -1, 1);
    const ny = THREE.MathUtils.clamp((splatCenter.y - center.y) / (safeSize.y * 0.5), -1, 1);
    const nz = THREE.MathUtils.clamp((splatCenter.z - center.z) / (safeSize.z * 0.5), -1, 1);
    const radial = THREE.MathUtils.clamp(Math.sqrt(nx * nx + nz * nz), 0, 1.45);
    const edge = THREE.MathUtils.clamp((Math.abs(nx) + Math.abs(ny) + Math.abs(nz)) / 2.15, 0, 1.25);
    const limbMask = characteristicFeatureMask(features, nx, ny, nz, radial, edge);
    if (limbMask <= 0.32) return;

    indices[cursor] = index;
    centers[i3] = splatCenter.x;
    centers[i3 + 1] = splatCenter.y;
    centers[i3 + 2] = splatCenter.z;
    scales[i3] = splatScale.x;
    scales[i3 + 1] = splatScale.y;
    scales[i3 + 2] = splatScale.z;
    quaternions[i4] = splatQuaternion.x;
    quaternions[i4 + 1] = splatQuaternion.y;
    quaternions[i4 + 2] = splatQuaternion.z;
    quaternions[i4 + 3] = splatQuaternion.w;
    opacities[cursor] = opacity;
    colors[i3] = splatColor.r;
    colors[i3 + 1] = splatColor.g;
    colors[i3 + 2] = splatColor.b;
    shape[i4] = nx;
    shape[i4 + 1] = ny;
    shape[i4 + 2] = nz;
    shape[i4 + 3] = limbMask;
    cursor += 1;
  });

  if (cursor === 0) return null;

  return {
    indices: indices.slice(0, cursor),
    centers: centers.slice(0, cursor * 3),
    scales: scales.slice(0, cursor * 3),
    quaternions: quaternions.slice(0, cursor * 4),
    opacities: opacities.slice(0, cursor),
    colors: colors.slice(0, cursor * 3),
    shape: shape.slice(0, cursor * 4),
    maxDimension,
    lastUpdate: -100,
    cursor: 0,
    restoreCursor: 0,
    isDeformed: false,
    center: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    color: new THREE.Color()
  };
}

function writeOriginalSplat(mesh: SparkSplatMesh, deformer: SplatCpuDeformer, entry: number) {
  const packedSplats = mesh.packedSplats;
  if (!packedSplats?.setSplat) return;
  const i3 = entry * 3;
  const i4 = entry * 4;
  deformer.center.set(deformer.centers[i3], deformer.centers[i3 + 1], deformer.centers[i3 + 2]);
  deformer.scale.set(deformer.scales[i3], deformer.scales[i3 + 1], deformer.scales[i3 + 2]);
  deformer.quaternion.set(
    deformer.quaternions[i4],
    deformer.quaternions[i4 + 1],
    deformer.quaternions[i4 + 2],
    deformer.quaternions[i4 + 3]
  );
  deformer.color.setRGB(deformer.colors[i3], deformer.colors[i3 + 1], deformer.colors[i3 + 2]);
  packedSplats.setSplat(
    deformer.indices[entry],
    deformer.center,
    deformer.scale,
    deformer.quaternion,
    deformer.opacities[entry],
    deformer.color
  );
}

function restoreSplatCpuDeformation(mesh: SparkSplatMesh, deformer: SplatCpuDeformer) {
  const packedSplats = mesh.packedSplats;
  if (!packedSplats?.setSplat) return;
  const writes = deformer.indices.length;
  for (let i = 0; i < writes; i += 1) {
    writeOriginalSplat(mesh, deformer, deformer.restoreCursor);
    deformer.restoreCursor += 1;
    if (deformer.restoreCursor >= deformer.indices.length) break;
  }
  packedSplats.needsUpdate = true;
  deformer.isDeformed = deformer.restoreCursor < deformer.indices.length;
  if (!deformer.isDeformed) {
    deformer.cursor = 0;
    deformer.restoreCursor = 0;
  }
}

function updateSplatCpuDeformation(
  mesh: SparkSplatMesh,
  deformer: SplatCpuDeformer,
  time: number,
  energy: number
) {
  const packedSplats = mesh.packedSplats;
  if (!packedSplats?.setSplat || deformer.indices.length === 0) return;
  if (time - deformer.lastUpdate < 1 / CPU_DEFORM_HZ) return;

  const writes = deformer.indices.length;
  if (writes <= 0) return;

  deformer.lastUpdate = time;
  const strength = THREE.MathUtils.clamp(energy, 0, 1.1);
  const count = deformer.indices.length;

  for (let write = 0; write < writes; write += 1) {
    const entry = deformer.cursor;
    deformer.cursor = (deformer.cursor + 1) % count;
    const i3 = entry * 3;
    const i4 = entry * 4;
    const x = deformer.shape[i4];
    const y = deformer.shape[i4 + 1];
    const z = deformer.shape[i4 + 2];
    const mask = deformer.shape[i4 + 3];
    const phase = (x >= 0 ? 0.0 : Math.PI) + (y > 0.35 ? 0.35 : 0.0) + (y < -0.35 ? -0.35 : 0.0);
    const side = THREE.MathUtils.smoothstep(Math.abs(x), 0.24, 0.98);
    const topBottom = THREE.MathUtils.smoothstep(Math.abs(y), 0.24, 0.96);
    const radial = THREE.MathUtils.clamp(Math.sqrt(x * x + z * z), 0, 1.45);
    const tail = THREE.MathUtils.smoothstep(radial, 0.5, 1.18);
    const signX = x >= 0 ? 1 : -1;
    const bodyWave = Math.sin(time * 2.7 + x * 1.35 + phase);
    const tailWave = Math.sin(time * 3.8 + x * 2.2 + phase) * tail;
    const limbSwing = Math.sin(time * 3.2 + phase) * side;
    const verticalNod = Math.cos(time * 2.4 + phase) * topBottom;
    const breathe = Math.sin(time * 1.15);
    const amp = deformer.maxDimension * 0.115 * strength * (0.35 + mask * 0.65);
    const radialLen = Math.max(0.001, Math.sqrt(x * x + y * y * 0.62 + z * z));

    deformer.center.set(
      deformer.centers[i3]
        + (x / radialLen) * breathe * amp * 0.18
        + signX * limbSwing * amp * 0.64,
      deformer.centers[i3 + 1]
        + verticalNod * amp * 0.42,
      deformer.centers[i3 + 2]
        + bodyWave * amp * 0.35
        + tailWave * amp * 1.35
        + limbSwing * amp * 0.24
    );
    deformer.scale.set(
      deformer.scales[i3],
      deformer.scales[i3 + 1],
      deformer.scales[i3 + 2]
    );
    deformer.quaternion.set(
      deformer.quaternions[i4],
      deformer.quaternions[i4 + 1],
      deformer.quaternions[i4 + 2],
      deformer.quaternions[i4 + 3]
    );
    deformer.color.setRGB(deformer.colors[i3], deformer.colors[i3 + 1], deformer.colors[i3 + 2]);
    packedSplats.setSplat(
      deformer.indices[entry],
      deformer.center,
      deformer.scale,
      deformer.quaternion,
      deformer.opacities[entry],
      deformer.color
    );
  }

  deformer.isDeformed = true;
  deformer.restoreCursor = 0;
  packedSplats.needsUpdate = true;
}

function createSplatParticleProxy(mesh: SparkSplatMesh, seed: number): SplatParticleProxy {
  const box = mesh.getBoundingBox(true);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const total = Math.max(1, mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 1);
  // ── Trail-style burst: many small glowing particles that diffuse outward ──
  const maxParticles = 760;
  const stride = Math.max(1, Math.ceil(total / maxParticles));
  const sampleCount = Math.ceil(total / stride);
  const positions = new Float32Array(sampleCount * 3);
  const directions = new Float32Array(sampleCount * 3);
  const glowColors = new Float32Array(sampleCount * 3);
  const coreColors = new Float32Array(sampleCount * 3);
  const phases = new Float32Array(sampleCount);
  const sizes = new Float32Array(sampleCount);
  const sparks = new Float32Array(sampleCount);
  const cameraRush = new Float32Array(sampleCount);
  const depths = new Float32Array(sampleCount);
  const tempDir = new THREE.Vector3();
  const tempColor = new THREE.Color();
  let cursor = 0;

  mesh.forEachSplat((index, splatCenter, _scales, _quaternion, _opacity) => {
    if (index % stride !== 0 || cursor >= sampleCount) return;
    const i3 = cursor * 3;
    positions[i3] = splatCenter.x;
    positions[i3 + 1] = splatCenter.y;
    positions[i3 + 2] = splatCenter.z;

    const phase = seededNoise(seed, index, 1) * Math.PI * 2;
    // Spherical outward direction
    const theta = seededNoise(seed, index, 2) * Math.PI * 2;
    const phi = Math.acos(2 * seededNoise(seed, index, 3) - 1);
    tempDir.set(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );

    // ── Pure spherical outward explosion, no camera bias ──
    // Direction is already a uniform random point on the sphere from phi/theta above
    // Keep as-is: true omnidirectional burst
    directions[i3] = tempDir.x;
    directions[i3 + 1] = tempDir.y;
    directions[i3 + 2] = tempDir.z;

    // Rainbow hue — full spectrum, deep saturated colors
    const hue = (seededNoise(seed, index, 7) + index * 0.00237) % 1;
    // Glow color: deep saturated  hsl(hue, 98%, 55%)
    tempColor.setHSL(hue, 0.98, 0.55);
    glowColors[i3] = tempColor.r;
    glowColors[i3 + 1] = tempColor.g;
    glowColors[i3 + 2] = tempColor.b;
    // Core color: brilliant  hsl(hue, 100%, 72%)
    tempColor.setHSL(hue, 1.0, 0.72);
    coreColors[i3] = tempColor.r;
    coreColors[i3 + 1] = tempColor.g;
    coreColors[i3 + 2] = tempColor.b;

    phases[cursor] = phase;
    // Layered particle sizes keep the burst dense without becoming a flat flash.
    sizes[cursor] = seededNoise(seed, index, 5) * 14 + 10;
    // Spark controls per-particle stagger & speed variation
    sparks[cursor] = seededNoise(seed, index, 6);
    // No camera bias — pure outward explosion
    cameraRush[cursor] = 0.0;
    // Depth for parallax / fade
    depths[cursor] = seededNoise(seed, index, 10) * 0.45 + 0.55;
    cursor += 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor * 3), 3));
  geometry.setAttribute('direction', new THREE.BufferAttribute(directions.slice(0, cursor * 3), 3));
  geometry.setAttribute('glowColor', new THREE.BufferAttribute(glowColors.slice(0, cursor * 3), 3));
  geometry.setAttribute('coreColor', new THREE.BufferAttribute(coreColors.slice(0, cursor * 3), 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases.slice(0, cursor), 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes.slice(0, cursor), 1));
  geometry.setAttribute('spark', new THREE.BufferAttribute(sparks.slice(0, cursor), 1));
  geometry.setAttribute('cameraRush', new THREE.BufferAttribute(cameraRush.slice(0, cursor), 1));
  geometry.setAttribute('trailDepth', new THREE.BufferAttribute(depths.slice(0, cursor), 1));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius *= 4.5;
  }

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uExplodeProgress: { value: 0 },
      uShock: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uExplodeProgress;
      uniform float uShock;
      uniform float uOpacity;
      uniform float uPixelRatio;
      attribute vec3 direction;
      attribute vec3 glowColor;
      attribute vec3 coreColor;
      attribute float phase;
      attribute float size;
      attribute float spark;
      attribute float cameraRush;
      attribute float trailDepth;
      varying vec3 vGlowColor;
      varying vec3 vCoreColor;
      varying float vAlpha;
      varying float vDepth;
      varying vec2 vScreenDir;
      varying float vRush;

      void main() {
        float progress = smoothstep(0.0, 1.0, uExplodeProgress);
        float localProgress = clamp((progress - spark * 0.08) / 0.92, 0.0, 1.0);

        // Life curve
        float life = smoothstep(0.0, 0.025, localProgress) * (1.0 - smoothstep(0.62, 1.0, localProgress));

        // Speed — explosive outward burst
        float speed = mix(0.68, 2.65, spark);
        float travel = localProgress * (0.72 + localProgress * 0.48);

        // Minimal wobble — particles fly straight outward
        float wobbleScale = 0.026;
        vec3 wobble = vec3(
          sin(uTime * 2.8 + phase) * wobbleScale,
          cos(uTime * 2.2 + phase + 0.7) * wobbleScale,
          sin(uTime * 2.5 + phase + 1.3) * wobbleScale
        ) * life;

        float gravity = localProgress * localProgress * 0.035;

        vec3 exploded = position
          + direction * speed * travel
          + wobble
          + vec3(0.0, -gravity, 0.0);

        vec4 mvPosition = modelViewMatrix * vec4(exploded, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Screen-space travel direction
        vec4 aheadMv = modelViewMatrix * vec4(exploded + direction * speed * 0.02, 1.0);
        vec4 aheadClip = projectionMatrix * aheadMv;
        vec2 currentScreen = gl_Position.xy / max(gl_Position.w, 0.0001);
        vec2 aheadScreen = aheadClip.xy / max(aheadClip.w, 0.0001);
        vec2 rawDir = aheadScreen - currentScreen;
        vScreenDir = length(rawDir) > 1e-6 ? normalize(rawDir) : vec2(1.0, 0.0);
        vRush = cameraRush;

        // ── Sprite sized for the meteor streak ──
        float shrink = max(0.3, 1.0 - localProgress * 0.35);
        float streakMul = 2.65;
        float pixelSize = size * shrink * streakMul * (0.7 + trailDepth * 0.3);
        gl_PointSize = pixelSize * uPixelRatio;

        vGlowColor = glowColor;
        vCoreColor = coreColor;
        vAlpha = uOpacity * life * (0.68 + trailDepth * 0.3);
        vDepth = trailDepth;
      }
    `,
    fragmentShader: `
      varying vec3 vGlowColor;
      varying vec3 vCoreColor;
      varying float vAlpha;
      varying float vDepth;
      varying vec2 vScreenDir;
      varying float vRush;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);

        float proj = dot(p, vScreenDir);
        vec2 perpDir = vec2(-vScreenDir.y, vScreenDir.x);
        float perp = dot(p, perpDir);

        // ── METEOR: bright head, natural exponential fade, soft wide streak ──

        // Head — small soft bright dot
        float headDist = length(p - vScreenDir * 0.04);
        float head = exp(-headDist * headDist * 600.0);            // tight bright point
        float headGlow = exp(-headDist * headDist * 35.0);         // soft halo
        float headAlpha = (head * 0.7 + headGlow * 0.15) * vDepth * vAlpha;

        // ── Streak: tapers in width, fades exponentially (physical light falloff) ──
        float streakLength = 0.48;
        float distAlong = clamp(-proj / streakLength, 0.0, 1.0);   // 0=head, 1=tail tip

        // Width tapers naturally
        float widthAtPoint = mix(0.055, 0.012, distAlong);

        // Exponential light falloff — physically natural
        float streakBody = exp(-(perp * perp) / (widthAtPoint * widthAtPoint));
        float streakBright = exp(-distAlong * 2.8);                 // exponential decay

        // Only behind the head
        float streakMask = smoothstep(0.005, -streakLength, proj);

        float streakAlpha = streakBody * streakBright * streakMask * 0.65 * vDepth * vAlpha;

        // ── Soft atmospheric scatter ──
        float scatterWidth = mix(0.12, 0.03, distAlong);
        float scatterBody = exp(-(perp * perp) / (scatterWidth * scatterWidth));
        float scatterAlpha = scatterBody * streakBright * 0.07 * streakMask * vDepth * vAlpha;

        float alpha = headAlpha + streakAlpha + scatterAlpha;
        if (alpha < 0.002) discard;

        // Color: soft white head → warm glow streak
        float headBlend = head * 0.7 + headGlow * 0.2;
        vec3 color = mix(vGlowColor, vec3(1.0), headBlend);
        // Streak stays the glow color, slightly brighter near head
        color = mix(color, vGlowColor, streakBody * streakBright * 0.5);

        gl_FragColor = vec4(min(color, vec3(0.95)), alpha);
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
  mesh.frustumCulled = true;
  return normalizedScale;
}
