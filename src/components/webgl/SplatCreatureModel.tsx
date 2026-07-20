import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SplatMesh as SparkSplatMesh } from '@sparkjsdev/spark';
import type { ArtworkFeatureResult } from '../../types/artwork';
import type { CreaturePartActionPose } from './creaturePartActions';
import { DADAKIDO_RENDER_ORDER } from './dadakidoOcclusion';
import {
  disposeCpuSplatPartMotion,
  installCpuSplatPartMotion,
  isCpuSplatPartRig,
  updateCpuSplatPartMotion,
  type CpuSplatPartMotionRuntime,
  type CpuSplatPartRig
} from './CpuSplatPartMotion';

type SplatCreatureModelProps = {
  url: string;
  rigUrl?: string;
  colors: string[];
  features: ArtworkFeatureResult;
  scale?: number;
  spotlightFocusRef?: RefObject<number>;
  burstRef?: MutableRefObject<number>;
  burstPhaseRef?: MutableRefObject<number>;
  reappearRef?: MutableRefObject<number>;
  loadVisibilityRef?: MutableRefObject<number>;
  renderOrderRef?: MutableRefObject<number>;
  partActionRef?: MutableRefObject<CreaturePartActionPose>;
  internalMotionStrengthRef?: MutableRefObject<number>;
  allowDistanceCulling?: boolean;
  flightWorldPositionRef?: MutableRefObject<THREE.Vector3>;
  flightOpacityRef?: MutableRefObject<number>;
  onReady?: () => void;
  onError?: (error: unknown) => void;
};

// TripoSplat exports use -Y as up and keep the authored front along the
// horizontal +X axis. Apply the same two-stage canonical transform as the
// reference viewer: first turn +X toward +Z, then flip the exported up axis.
// Keeping this correction on the mesh lets the parent visual group own only
// the live camera-facing yaw.
const SPLAT_CANONICAL_ROTATION = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2
  ));

type SplatParticleProxy = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

const RIG_POLL_FAST_INTERVAL_MS = 900;
const RIG_POLL_SLOW_INTERVAL_MS = 1_800;
const RIG_POLL_TIMEOUT_MS = 8 * 60_000;

function isPendingPartMap(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { strategy?: unknown; status?: unknown };
  return ['cpu-rigid-parts', 'gpu-splat-skinning', 'cpu-splat-bone-mapping'].includes(String(candidate.strategy))
    && candidate.status === 'processing';
}

function isOutdatedPartMap(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { strategy?: unknown; version?: unknown };
  return ['cpu-rigid-parts', 'gpu-splat-skinning', 'cpu-splat-bone-mapping'].includes(String(candidate.strategy))
    && Number(candidate.version ?? 0) < 14;
}

function isUnavailablePartMap(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { enabled?: unknown; status?: unknown };
  return candidate.enabled === false
    || ['failed', 'unavailable', 'disabled'].includes(String(candidate.status));
}

export function SplatCreatureModel(props: SplatCreatureModelProps) {
  const { rigUrl } = props;
  const [rig, setRig] = useState<CpuSplatPartRig | null>(null);

  useEffect(() => {
    if (!rigUrl) {
      setRig(null);
      return;
    }
    const controller = new AbortController();
    const startedAt = performance.now();
    let retryTimer: number | undefined;
    let disposed = false;
    setRig(null);

    const scheduleRetry = () => {
      if (disposed || performance.now() - startedAt >= RIG_POLL_TIMEOUT_MS) return false;
      const elapsed = performance.now() - startedAt;
      const delay = elapsed < 90_000 ? RIG_POLL_FAST_INTERVAL_MS : RIG_POLL_SLOW_INTERVAL_MS;
      retryTimer = window.setTimeout(pollRig, delay);
      return true;
    };

    const pollRig = async () => {
      try {
        const response = await fetch(rigUrl, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 404) {
            scheduleRetry();
            return;
          }
          throw new Error(`Splat rig request failed with ${response.status}.`);
        }
        const payload = await response.json() as unknown;
        if (disposed) return;
        if (isCpuSplatPartRig(payload)) {
          setRig(payload);
          return;
        }
        if ((isPendingPartMap(payload) || isOutdatedPartMap(payload)) && scheduleRetry()) return;
        if (isUnavailablePartMap(payload)) return;
        console.warn('[splat-part-motion] Background analysis finished without a usable part map:', payload);
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        if (scheduleRetry()) return;
        console.warn('[splat-part-motion] Intact model will remain static:', error);
      }
    };

    void pollRig();
    return () => {
      disposed = true;
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [rigUrl]);

  // The intact Splat starts loading immediately. CPU part motion is installed later
  // when its tiny manifest and part map are ready, so analysis never blocks
  // first display and never starts duplicate part-model requests.
  return <StaticSplatCreatureModel {...props} rig={rig} />;
}

function StaticSplatCreatureModel({
  url,
  rigUrl,
  rig,
  features,
  scale = 0.58,
  spotlightFocusRef,
  burstRef,
  burstPhaseRef,
  reappearRef,
  loadVisibilityRef,
  renderOrderRef,
  partActionRef,
  internalMotionStrengthRef,
  allowDistanceCulling = true,
  flightWorldPositionRef,
  flightOpacityRef,
  onReady,
  onError
}: SplatCreatureModelProps & { rig: CpuSplatPartRig | null }) {
  const meshRef = useRef<SparkSplatMesh | null>(null);
  const particleProxyGroupRef = useRef<THREE.Group>(null);
  const particleProxyRef = useRef<THREE.Points>(null);
  const cpuPartMotionRef = useRef<CpuSplatPartMotionRuntime | null>(null);
  const idlePartMotionStartedAtRef = useRef<number | null>(null);
  const baseScaleRef = useRef(scale);
  const basePositionRef = useRef(new THREE.Vector3());
  const flightLocalPositionRef = useRef(new THREE.Vector3());
  const cameraDistancePositionRef = useRef(new THREE.Vector3());
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const whiteColorRef = useRef(new THREE.Color('#ffffff'));
  const [failed, setFailed] = useState(false);
  const [splat, setSplat] = useState<SparkSplatMesh | null>(null);
  const [particleProxy, setParticleProxy] = useState<SplatParticleProxy | null>(null);
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
    let proxyIdleId: number | undefined;
    let proxyTimerId: number | undefined;
    setFailed(false);
    setSplat(null);
    setParticleProxy((proxy) => {
      proxy?.geometry.dispose();
      proxy?.material.dispose();
      return null;
    });
    meshRef.current = null;
    disposeCpuSplatPartMotion(cpuPartMotionRef.current);
    cpuPartMotionRef.current = null;

    import('@sparkjsdev/spark')
      .then(({ SplatMesh }) => {
        if (disposed) return;
        const mesh = new SplatMesh({ url });

        loadedMesh = mesh;
        meshRef.current = mesh;
        mesh.visible = true;

        mesh.initialized
          .then((initializedMesh) => {
            if (disposed || meshRef.current !== initializedMesh) return;
            baseScaleRef.current = normalizeSplatMesh(initializedMesh, scale);
            basePositionRef.current.copy(initializedMesh.position);
            // White is Spark's neutral recolor multiplier, so the authored
            // Gaussian colors remain unchanged throughout the animation.
            initializedMesh.recolor.copy(whiteColorRef.current);
            setSplat(initializedMesh);
            onReadyRef.current?.();
            const createParticleProxy = () => {
              if (disposed || meshRef.current !== initializedMesh) return;
              setParticleProxy((proxy) => {
                proxy?.geometry.dispose();
                proxy?.material.dispose();
                return createSplatParticleProxy(initializedMesh, motionPhase);
              });
            };
            if ('requestIdleCallback' in window) {
              proxyIdleId = window.requestIdleCallback(createParticleProxy, { timeout: 1_500 });
            } else {
              proxyTimerId = window.setTimeout(createParticleProxy, 320);
            }
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
      if (proxyIdleId !== undefined) window.cancelIdleCallback(proxyIdleId);
      if (proxyTimerId !== undefined) window.clearTimeout(proxyTimerId);
      disposeCpuSplatPartMotion(cpuPartMotionRef.current);
      cpuPartMotionRef.current = null;
      meshRef.current = null;
      loadedMesh?.dispose();
      setParticleProxy((proxy) => {
        proxy?.geometry.dispose();
        proxy?.material.dispose();
        return null;
      });
    };
  }, [motionPhase, scale, url]);

  useEffect(() => {
    const mesh = splat;
    disposeCpuSplatPartMotion(cpuPartMotionRef.current);
    cpuPartMotionRef.current = null;
    if (!mesh || !rig || !isCpuSplatPartRig(rig) || !rigUrl || failed) return;
    const controller = new AbortController();
    // Mapping tens of thousands of splats is intentionally staggered across
    // models. The intact model is already visible while this work hot-loads.
    const installTimer = window.setTimeout(() => {
      installCpuSplatPartMotion({ mesh, rig, rigUrl, signal: controller.signal })
        .then((runtime) => {
          if (controller.signal.aborted || meshRef.current !== mesh) {
            disposeCpuSplatPartMotion(runtime);
            return;
          }
          cpuPartMotionRef.current = runtime;
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.warn('[splat-part-motion] CPU part map was rejected; keeping the intact model:', error);
        });
    }, 80 + Math.abs(hashString(url)) % 620);
    return () => {
      window.clearTimeout(installTimer);
      controller.abort();
      if (cpuPartMotionRef.current?.mesh === mesh) {
        disposeCpuSplatPartMotion(cpuPartMotionRef.current);
        cpuPartMotionRef.current = null;
      }
    };
  }, [failed, rig, rigUrl, splat]);

  useFrame(({ clock, camera }) => {
    const mesh = meshRef.current;
    if (!mesh || failed) return;

    const t = clock.elapsedTime;
    const internalMotionStrength = internalMotionStrengthRef?.current ?? 1;
    const breath = 1 + Math.sin(t * 0.52) * 0.018 * internalMotionStrength;
    const focus = spotlightFocusRef?.current ?? 0;
    const burst = burstRef?.current ?? 0;
    const burstPhase = burstPhaseRef?.current ?? (burst > 0 ? 0.5 : 1);
    const reappear = reappearRef?.current ?? 1;
    const loadVisibility = loadVisibilityRef?.current ?? 1;
    const flightOpacity = flightOpacityRef?.current ?? 0;
    const flightWorldPosition = flightWorldPositionRef?.current;
    const burstShock = THREE.MathUtils.smoothstep(burst, 0, 1);
    const isBursting = burstPhase < 0.995;
    const showFlightModel = flightOpacity > 0.01;
    const baseScale = baseScaleRef.current * breath;
    mesh.renderOrder = renderOrderRef?.current ?? 0;
    const burstScale = 1 + burstShock * 0.055;
    mesh.scale.setScalar(baseScale * burstScale);
    const locomotion = features.behaviorTraits.locomotionType;
    const swimming = locomotion === 'swimming';
    const flying = locomotion === 'flying';
    const freeBodyMotion = 1 - focus;
    // Canonical orientation is applied once during normalization. Runtime pose
    // belongs to the parent visual group, avoiding Euler accumulation here.
    const glowPulse = 0.5 + Math.sin(t * 1.1 + motionPhase) * 0.5 * internalMotionStrength;
    mesh.recolor.copy(whiteColorRef.current);
    mesh.position.copy(basePositionRef.current);
    if (swimming || flying) {
      mesh.position.y += Math.sin(t * (swimming ? 1.35 : 1.7) + motionPhase)
        * baseScale * 0.03 * freeBodyMotion * internalMotionStrength;
    }
    if (flightWorldPosition && flightOpacity > 0.001) {
      flightLocalPositionRef.current.copy(flightWorldPosition);
      mesh.parent?.worldToLocal(flightLocalPositionRef.current);
      mesh.position.copy(flightLocalPositionRef.current).add(basePositionRef.current);
    }
    const distanceToCamera = mesh.getWorldPosition(cameraDistancePositionRef.current).distanceTo(camera.position);
    const distanceCulled = allowDistanceCulling
      && distanceToCamera > 28
      && !showFlightModel
      && !isBursting;
    const burstModelOpacity = isBursting
      ? 1 - THREE.MathUtils.smootherstep(burstPhase, 0.015, 0.2)
      : 0;
    const isInFrontOfDadakido = (renderOrderRef?.current ?? 0) > DADAKIDO_RENDER_ORDER;
    const baseModelOpacity = THREE.MathUtils.lerp(0.86, 0.97, glowPulse);
    const modelOpacity = isInFrontOfDadakido
      ? Math.min(1, baseModelOpacity + 0.045)
      : baseModelOpacity;
    mesh.opacity = modelOpacity
      * Math.max(reappear, flightOpacity, burstModelOpacity)
      * loadVisibility;
    mesh.visible = (!isBursting || burstModelOpacity > 0.01 || showFlightModel) && !distanceCulled;

    const cpuPartMotion = cpuPartMotionRef.current;
    if (cpuPartMotion && mesh.visible && Math.max(reappear, flightOpacity) > 0.2) {
      // Resting creatures return to their authored neutral pose. Internal joint
      // motion is enabled only by an explicit active state supplied by the parent.
      const motionEnergy = 0.18
        * internalMotionStrength
        * (1 - focus * 0.82)
        * (1 - burstShock);
      const partAction = partActionRef?.current;
      const actionActive = Boolean(partAction && partAction.kind !== 'idle');
      if (motionEnergy > 0.002 || actionActive) {
        idlePartMotionStartedAtRef.current = null;
      } else if (idlePartMotionStartedAtRef.current === null) {
        idlePartMotionStartedAtRef.current = t;
      }
      const settling = idlePartMotionStartedAtRef.current !== null
        && t - idlePartMotionStartedAtRef.current < 1.1;
      if (motionEnergy > 0.002 || actionActive || settling) {
        updateCpuSplatPartMotion(
          cpuPartMotion,
          t,
          motionEnergy,
          locomotion,
          partAction
        );
      }
    }

    const proxyGroup = particleProxyGroupRef.current;
    const proxyPoints = particleProxyRef.current;
    if (proxyGroup && proxyPoints) {
      proxyPoints.renderOrder = (renderOrderRef?.current ?? 10) + 3;
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

  mesh.quaternion.copy(SPLAT_CANONICAL_ROTATION);
  mesh.frustumCulled = true;
  return normalizedScale;
}
