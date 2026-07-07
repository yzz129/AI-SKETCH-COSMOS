import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { StoredArtwork } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { crowdAvoidance, nearestFoodAttraction, pointerAvoidance, useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import {
  createCreatureMotionConfig,
  getCreatureActionPose,
  getCreatureMotionPose,
  getCreatureMotionPreset,
  pickCreatureAction
} from '../../utils/creatureMotion';
import { CreatureAuraDust } from './CreatureAuraDust';
import { ParticleCreature } from './ParticleCreature';
import { ParticleCreatureTrail } from './ParticleCreatureTrail';
import { SplatCreatureModel } from './SplatCreatureModel';
import {
  SPOTLIGHT_FLY_IN_DURATION,
  SPOTLIGHT_RELEASE_DURATION,
  SPOTLIGHT_SHOWCASE_DURATION
} from './spotlightConfig';
import { CREATURE_ORBIT_CENTER } from './cosmicAnchors';

type SpaceCreatureProps = {
  artwork: StoredArtwork;
  index: number;
};

const RESPAWN_TRAIL_DURATION = 1.65;
const RESPAWN_REAPPEAR_DELAY = 1.35;
const RESPAWN_TRAIL_MODEL_CLEARANCE = 0.42;

type RespawnMeteorTrailProps = {
  startRef: MutableRefObject<THREE.Vector3 | null>;
  endRef: MutableRefObject<THREE.Vector3 | null>;
  startedAtRef: MutableRefObject<number>;
};

function createRespawnTrailMaterial(core: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uCore: { value: core ? 1 : 0 },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uFlow: { value: 0 },
      uWarp: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uCore;
      uniform float uTime;
      uniform float uSeed;
      uniform float uFlow;
      uniform float uWarp;
      varying vec2 vUv;

      vec3 colorWheel(float h) {
        vec3 p = abs(fract(h + vec3(0.0, 0.66, 0.33)) * 6.0 - 3.0);
        return clamp(p - 1.0, 0.0, 1.0);
      }

      void main() {
        float x = vUv.x;
        float centerWarp = (
          sin(x * 8.0 + uTime * 3.2 + uSeed * 12.0) * 0.038 +
          sin(x * 17.0 - uTime * 4.6 + uSeed * 7.0) * 0.018
        ) * uWarp * (1.0 - smoothstep(0.78, 1.0, x));
        float y = abs(vUv.y - 0.5 - centerWarp) * 2.0;

        float widthPulse = 1.0
          + sin(x * 10.0 + uTime * 4.2 + uSeed * 19.0) * 0.16
          + sin(x * 23.0 - uTime * 3.4 + uSeed * 5.0) * 0.08;
        float width = mix(0.025, mix(0.34, 0.14, uCore), pow(x, 0.72)) * widthPulse;
        float softBody = exp(-pow(y / max(width, 0.001), 2.0) * mix(2.4, 4.4, uCore));
        float tailFade = smoothstep(0.02, mix(0.2, 0.34, uWarp), x);
        float headFade = 1.0 - smoothstep(0.84, 0.99, x);
        float energyRipple = 0.86 + 0.14 * sin(x * 18.0 + uTime * 7.0 + uSeed * 11.0);
        float energy = mix(0.2, 1.0, smoothstep(0.05, 0.72, x)) * energyRipple;
        float alpha = softBody * tailFade * headFade * energy;

        float hue = fract(uSeed + uFlow * 0.42 + x * (0.42 + uWarp * 0.32));
        vec3 color = colorWheel(hue);
        vec3 nextColor = colorWheel(hue + 0.18 + sin(uTime * 1.7 + uSeed * 9.0) * 0.05);
        color = mix(color, nextColor, smoothstep(0.18, 0.86, x));
        color = mix(color, vec3(1.0, 0.72, 0.96), smoothstep(0.68, 0.94, x) * 0.16);
        alpha *= mix(0.44, 0.72, uCore) * uOpacity;

        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

function createRespawnHeadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(64, 64, 1, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,244,255,.78)');
  glow.addColorStop(0.18, 'rgba(255,105,222,.52)');
  glow.addColorStop(0.44, 'rgba(116,166,255,.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function RespawnMeteorTrail({ startRef, endRef, startedAtRef }: RespawnMeteorTrailProps) {
  const mainRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const headTexture = useMemo(createRespawnHeadTexture, []);
  const mainMaterial = useMemo(() => createRespawnTrailMaterial(false), []);
  const coreMaterial = useMemo(() => createRespawnTrailMaterial(true), []);
  const headMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    map: headTexture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 0
  }), [headTexture]);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const head = useMemo(() => new THREE.Vector3(), []);
  const trailAttach = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const cameraVector = useMemo(() => new THREE.Vector3(), []);
  const xAxis = useMemo(() => new THREE.Vector3(), []);
  const yAxis = useMemo(() => new THREE.Vector3(), []);
  const zAxis = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => () => {
    headTexture.dispose();
    mainMaterial.dispose();
    coreMaterial.dispose();
    headMaterial.dispose();
  }, [coreMaterial, headMaterial, headTexture, mainMaterial]);

  useFrame(({ camera }) => {
    const start = startRef.current;
    const end = endRef.current;
    const main = mainRef.current;
    const core = coreRef.current;
    const headMesh = headRef.current;
    if (!start || !end || !main || !core || !headMesh) return;

    const age = performance.now() * 0.001 - startedAtRef.current;
    const fadeEnd = RESPAWN_TRAIL_DURATION + 0.55;
    if (age < 0 || age > fadeEnd) {
      main.visible = false;
      core.visible = false;
      headMesh.visible = false;
      return;
    }

    direction.copy(end).sub(start);
    const distance = direction.length();
    if (distance < 0.001) {
      main.visible = false;
      core.visible = false;
      headMesh.visible = false;
      return;
    }

    const progress = THREE.MathUtils.clamp(age / RESPAWN_TRAIL_DURATION, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0.015, 0.12);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(age, RESPAWN_TRAIL_DURATION * 0.9, fadeEnd);
    const fade = fadeIn * fadeOut;
    const spatialSeed = Math.abs(
      Math.sin(
        start.x * 12.9898 + start.y * 78.233 + start.z * 37.719 +
        end.x * 19.913 + end.y * 43.121 + end.z * 11.137
      )
    );
    const depthSwing = THREE.MathUtils.clamp(Math.abs(end.z - start.z) / 8.5, 0, 1);
    const verticalSwing = THREE.MathUtils.clamp(Math.abs(end.y - start.y) / 4.2, 0, 1);
    const distanceSwing = THREE.MathUtils.clamp((distance - 5.5) / 7.5, 0, 1);
    const shapeVariance = 0.78 + spatialSeed * 0.44 + depthSwing * 0.22 - verticalSwing * 0.12;
    const travelPulse = 1 + Math.sin(progress * Math.PI * 2.0 + spatialSeed * 6.28) * 0.1;
    const colorFlow = age * (0.85 + spatialSeed * 0.9) + progress * (0.55 + distanceSwing * 0.4);
    const warp = THREE.MathUtils.clamp(0.28 + depthSwing * 0.42 + verticalSwing * 0.22 + spatialSeed * 0.18, 0.22, 0.95);

    xAxis.copy(direction).normalize();
    head.copy(start).lerp(end, eased);
    const modelClearance = THREE.MathUtils.clamp(
      RESPAWN_TRAIL_MODEL_CLEARANCE + distanceSwing * 0.12,
      0.34,
      0.58
    );
    trailAttach.copy(head).addScaledVector(xAxis, -modelClearance);
    const visibleLength = Math.min(distance * 0.74, 5.6) * (0.44 + progress * 0.72) * fade;
    const visibleWidth = (0.16 + 0.14 * fade)
      * THREE.MathUtils.clamp(distance / 6, 0.68, 1.18)
      * shapeVariance
      * travelPulse;
    center.copy(trailAttach).addScaledVector(xAxis, -visibleLength * 0.5);

    cameraVector.copy(camera.position).sub(center).normalize();
    yAxis.copy(cameraVector).cross(xAxis);
    if (yAxis.lengthSq() < 0.0001) {
      yAxis.set(0, 1, 0).cross(xAxis);
    }
    yAxis.normalize();
    zAxis.copy(xAxis).cross(yAxis).normalize();
    basis.makeBasis(xAxis, yAxis, zAxis);
    quaternion.setFromRotationMatrix(basis);

    main.visible = fade > 0.002;
    core.visible = main.visible;
    headMesh.visible = main.visible;
    main.position.copy(center);
    core.position.copy(center).addScaledVector(zAxis, 0.006);
    main.quaternion.copy(quaternion);
    core.quaternion.copy(quaternion);
    main.scale.set(Math.max(visibleLength, 0.001), visibleWidth, 1);
    core.scale.set(Math.max(visibleLength * (0.76 + spatialSeed * 0.14), 0.001), visibleWidth * (0.5 + depthSwing * 0.16), 1);
    mainMaterial.uniforms.uOpacity.value = 0.98 * fade;
    coreMaterial.uniforms.uOpacity.value = 0.78 * fade;
    mainMaterial.uniforms.uTime.value = age;
    coreMaterial.uniforms.uTime.value = age + 0.17;
    mainMaterial.uniforms.uSeed.value = spatialSeed;
    coreMaterial.uniforms.uSeed.value = (spatialSeed + 0.31) % 1;
    mainMaterial.uniforms.uFlow.value = colorFlow;
    coreMaterial.uniforms.uFlow.value = colorFlow + 0.22;
    mainMaterial.uniforms.uWarp.value = warp;
    coreMaterial.uniforms.uWarp.value = warp * 0.55;

    headMesh.position.copy(trailAttach).addScaledVector(xAxis, 0.025);
    headMesh.quaternion.copy(camera.quaternion);
    headMesh.scale.setScalar((0.1 + 0.06 * fade + distanceSwing * 0.03) * fade);
    headMaterial.opacity = 0.22 * fade;
    headMaterial.color.setHSL((spatialSeed + colorFlow * 0.18) % 1, 0.92, 0.68);
  });

  return (
    <group renderOrder={12} frustumCulled={false}>
      <mesh ref={mainRef} material={mainMaterial} renderOrder={12} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={coreRef} material={coreMaterial} renderOrder={13} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={headRef} material={headMaterial} renderOrder={14} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

export function SpaceCreature({ artwork, index }: SpaceCreatureProps) {
  const spotlightCreatureId = useSketchStore((state) => state.spotlight.creatureId);
  const spotlightPhase = useSketchStore((state) => state.spotlight.phase);
  const groupRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number | null>(null);
  const pulseRef = useRef(0);
  const burstRef = useRef(0);
  const burstPhaseRef = useRef(1);
  const reappearRef = useRef(1);
  const spotlightFocusRef = useRef(0);
  const spotlightAnchorRef = useRef<THREE.Vector3 | null>(null);
  const wasSpotlightRef = useRef(false);
  const pulseStartedAtRef = useRef(-100);
  const burstStartedAtRef = useRef(-100);
  const burstAnchorRef = useRef<THREE.Vector3 | null>(null);
  const burstWasActiveRef = useRef(false);
  const respawnPositionRef = useRef<THREE.Vector3 | null>(null);
  const respawnStartedAtRef = useRef(-100);
  const respawnTrailStartRef = useRef<THREE.Vector3 | null>(null);
  const respawnTrailEndRef = useRef<THREE.Vector3 | null>(null);
  const respawnTrailStartedAtRef = useRef(-100);
  const flightModelWorldPositionRef = useRef(new THREE.Vector3());
  const flightModelOpacityRef = useRef(0);
  const lastPositionRef = useRef(new THREE.Vector3());
  const smoothedOffsetRef = useRef(new THREE.Vector3());
  const preset = useMemo(
    () => getCreatureMotionPreset(artwork.motionType, artwork.behaviorSignature),
    [artwork.behaviorSignature, artwork.motionType]
  );
  const motion = useMemo(
    () => createCreatureMotionConfig(index, artwork.motionType, artwork.behaviorSignature),
    [artwork.behaviorSignature, artwork.motionType, index]
  );
  /* ---- Kepler orbit params (same physics as OrbitalPlanets) ---- */
  const orbitParams = useMemo(() => {
    const baseRadii = [4.2, 5.8, 7.6, 9.5, 11.0, 13.0];
    const orbitRadius = baseRadii[index % baseRadii.length];
    // Kepler's 3rd law: ω ∝ r^(−3/2)
    const orbitSpeed = 0.36 * Math.pow(orbitRadius / 4.2, -1.5);
    const inclination = (index % 3 - 1) * 0.22;
    const phaseOffset = index * 0.61803398875 + motion.phase * 0.031;
    return { orbitRadius, orbitSpeed, inclination, phaseOffset };
  }, [index, motion.phase]);
  const interactionMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);
  const worldPositionScratchRef = useRef(new THREE.Vector3());

  // ── Preview image plane material (visible during spotlight) ──
  const [previewTexture, setPreviewTexture] = useState<THREE.Texture | null>(null);
  const [, setSplatReady] = useState(false);
  const previewMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    map: previewTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  }), [previewTexture]);

  useEffect(() => {
    let disposed = false;
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setPreviewTexture(tex);
    };
    img.src = artwork.url;
    return () => {
      disposed = true;
    };
  }, [artwork.url]);

  const maxSize = 1.05;
  const planeWidth = artwork.aspect >= 1 ? maxSize : maxSize * artwork.aspect;
  const planeHeight = artwork.aspect >= 1 ? maxSize / artwork.aspect : maxSize;
  const spotlightEnabled = spotlightCreatureId === artwork.id && spotlightPhase !== 'idle';
  const splatUrl = artwork.gaussianModel?.status === 'ready' ? artwork.gaussianModel.splatUrl : undefined;

  const pickRespawnPosition = (awayFrom?: THREE.Vector3) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(12.5),
        THREE.MathUtils.randFloat(-3.2, 3.35),
        CREATURE_ORBIT_CENTER.z + THREE.MathUtils.randFloat(-4.2, 9.2)
      );

      if (!awayFrom || candidate.distanceTo(awayFrom) > 5.5) {
        return candidate;
      }
    }

    return new THREE.Vector3(
      (awayFrom?.x ?? 0) + (Math.random() > 0.5 ? 6.2 : -6.2),
      THREE.MathUtils.randFloat(-3.2, 3.35),
      CREATURE_ORBIT_CENTER.z + THREE.MathUtils.randFloat(-4.2, 9.2)
    );
  };

  useEffect(() => {
    setSplatReady(false);
  }, [splatUrl]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    const visual = visualRef.current;
    if (!group) return;

    const time = clock.elapsedTime;
    const wallTime = performance.now() * 0.001;

    if (startTimeRef.current === null) {
      startTimeRef.current = time;
    }

    const localTime = time - startTimeRef.current;
    const entryProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(localTime / 1.15, 0, 1), 0, 1);

    // ── spotlight showcase mode ──
    const spotlight = useSketchStore.getState().spotlight;
    const isSpotlight = spotlight.creatureId === artwork.id && spotlight.phase !== 'idle';
    const spotlightElapsed = isSpotlight ? (Date.now() - spotlight.startedAt) / 1000 : 0;
    const spotlightYaw = isSpotlight && spotlight.phase === 'showcase'
      ? Math.sin(time * 0.22 + motion.phase) * 0.06
      : 0;

    /* ---- Kepler orbit around dadakido (same physics as planets) ---- */
    const orbitAngle = time * orbitParams.orbitSpeed + orbitParams.phaseOffset;
    const cosA = Math.cos(orbitAngle);
    const sinA = Math.sin(orbitAngle);
    const cosInc = Math.cos(orbitParams.inclination);
    const sinInc = Math.sin(orbitParams.inclination);
    const orbitX = cosInc * cosA * orbitParams.orbitRadius;
    const orbitY = sinInc * cosA * orbitParams.orbitRadius
      + Math.sin(time * 0.45 + motion.phase) * 0.15;
    const orbitZ = cosInc * sinA * orbitParams.orbitRadius;
    const pathPosition = CREATURE_ORBIT_CENTER.clone()
      .add(new THREE.Vector3(orbitX, orbitY, orbitZ));
    // tangent for roll calculation
    const tangent = new THREE.Vector3(
      -sinA * cosInc * orbitParams.orbitRadius,
      cosA * sinInc * orbitParams.orbitRadius - Math.sin(time * 0.45 + motion.phase + 1.57) * 0.15 * 0.45,
      cosA * cosInc * orbitParams.orbitRadius
    ).normalize();
    const foodOffset = nearestFoodAttraction(pathPosition, wallTime);
    const avoidOffset = pointerAvoidance(pathPosition).add(crowdAvoidance(artwork.id, pathPosition));
    const targetOffset = foodOffset.add(avoidOffset);
    smoothedOffsetRef.current.lerp(targetOffset, 1 - Math.exp(-delta * 2.4));

    const basePose = getCreatureMotionPose(artwork.motionType, time, motion.phase);
    const activeAction = pickCreatureAction(artwork.actionTypes, time, motion.phase);
    const actionPose = getCreatureActionPose(activeAction, time, motion.phase);
    const targetPosition = pathPosition.clone().add(smoothedOffsetRef.current).add(new THREE.Vector3(
      basePose.extraX + actionPose.offsetX,
      basePose.extraY + actionPose.offsetY,
      basePose.extraZ + actionPose.offsetZ
    ));
    const x = THREE.MathUtils.lerp(motion.entryX, targetPosition.x, entryProgress);
    const y = THREE.MathUtils.lerp(motion.entryY, targetPosition.y, entryProgress);
    const z = THREE.MathUtils.lerp(motion.entryZ, targetPosition.z, entryProgress);
    const farOrbitZ = CREATURE_ORBIT_CENTER.z - 14.0;
    const nearOrbitZ = CREATURE_ORBIT_CENTER.z + 14.0;
    const depthFactor = THREE.MathUtils.mapLinear(
      THREE.MathUtils.clamp(z, farOrbitZ, nearOrbitZ),
      farOrbitZ,
      nearOrbitZ,
      0.54,
      1.38
    );
    const entryGlow = 1 + (1 - entryProgress) * 0.2;
    const normalScale = motion.baseScale * 0.95 * depthFactor * entryGlow;

    // ── Spotlight: creature stays at path position, camera does the close-up ──
    const pathWorldPosition = new THREE.Vector3(x, y, z);
    const releaseStart = SPOTLIGHT_FLY_IN_DURATION + SPOTLIGHT_SHOWCASE_DURATION;
    const releaseProgress = isSpotlight && spotlight.phase === 'release'
      ? THREE.MathUtils.clamp((spotlightElapsed - releaseStart) / SPOTLIGHT_RELEASE_DURATION, 0, 1)
      : 0;

    if (isSpotlight && (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase')) {
      if (!wasSpotlightRef.current || !spotlightAnchorRef.current) {
        spotlightAnchorRef.current = group.position.lengthSq() > 0.0001
          ? group.position.clone()
          : pathWorldPosition.clone();
      }
      wasSpotlightRef.current = true;
      group.position.copy(spotlightAnchorRef.current);
    } else if (isSpotlight && spotlight.phase === 'release' && spotlightAnchorRef.current) {
      group.position.lerpVectors(spotlightAnchorRef.current, pathWorldPosition, releaseProgress);
    } else {
      wasSpotlightRef.current = false;
      spotlightAnchorRef.current = null;
      group.position.copy(pathWorldPosition);
    }

    if (isSpotlight && (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase')) {
      const focusProgress = spotlight.phase === 'fly-in'
        ? 1 - Math.pow(1 - THREE.MathUtils.clamp(spotlightElapsed / SPOTLIGHT_FLY_IN_DURATION, 0, 1), 3)
        : 1;
      spotlightFocusRef.current = focusProgress;
      // Subtle scale boost only — camera provides the close-up
      group.scale.setScalar(normalScale * (1 + focusProgress * 0.08));
    } else if (isSpotlight && spotlight.phase === 'release') {
      spotlightFocusRef.current = 1 - releaseProgress;
      group.scale.setScalar(normalScale * (1 + (1 - releaseProgress) * 0.08));
    } else {
      spotlightFocusRef.current = 0;
      group.scale.setScalar(normalScale);
    }
    const pulseAge = wallTime - pulseStartedAtRef.current;
    pulseRef.current = pulseAge < 1.15 ? Math.sin((1 - pulseAge / 1.15) * Math.PI) * 0.9 : 0;
    const burstAge = wallTime - burstStartedAtRef.current;
    const burstDuration = splatUrl ? 1.55 : 1.35;
    const burstActive = burstAge >= 0 && burstAge < burstDuration;
    const burstProgress = THREE.MathUtils.clamp(burstAge / burstDuration, 0, 1);
    burstRef.current = burstActive ? Math.sin(burstProgress * Math.PI) : 0;
    burstPhaseRef.current = burstActive ? burstProgress : 1;

    if (burstActive && !burstWasActiveRef.current) {
      const previousBurstAnchor = burstAnchorRef.current?.clone() ?? group.position.clone();
      const nextRespawnPosition = pickRespawnPosition(previousBurstAnchor);
      burstAnchorRef.current = previousBurstAnchor;
      burstWasActiveRef.current = true;
      respawnPositionRef.current = nextRespawnPosition;
      respawnStartedAtRef.current = wallTime;
      respawnTrailStartRef.current = previousBurstAnchor.clone();
      respawnTrailEndRef.current = nextRespawnPosition.clone();
      respawnTrailStartedAtRef.current = wallTime;
      reappearRef.current = 0;
    }

    if (!burstActive && burstWasActiveRef.current) {
      burstWasActiveRef.current = false;
      if (!respawnPositionRef.current) {
        const previousBurstAnchor = burstAnchorRef.current?.clone();
        const nextRespawnPosition = pickRespawnPosition(previousBurstAnchor);
        respawnPositionRef.current = nextRespawnPosition;
        respawnStartedAtRef.current = wallTime;
        respawnTrailStartRef.current = previousBurstAnchor ?? group.position.clone();
        respawnTrailEndRef.current = nextRespawnPosition.clone();
        respawnTrailStartedAtRef.current = wallTime;
      }
      burstAnchorRef.current = null;
    }

    if (burstActive && burstAnchorRef.current) {
      group.position.copy(burstAnchorRef.current);
      reappearRef.current = 0;
    } else if (respawnPositionRef.current) {
      const respawnAge = wallTime - respawnStartedAtRef.current;
      const visibleAge = Math.max(0, respawnAge - RESPAWN_REAPPEAR_DELAY);
      const fadeProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(visibleAge / 1.05, 0, 1), 0, 1);
      const returnProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((visibleAge - 1.0) / 3.2, 0, 1), 0, 1);
      group.position.lerpVectors(respawnPositionRef.current, pathWorldPosition, returnProgress);
      reappearRef.current = fadeProgress;

      if (returnProgress >= 0.995) {
        respawnPositionRef.current = null;
        reappearRef.current = 1;
      }
    } else {
      reappearRef.current = 1;
    }

    const trailStart = respawnTrailStartRef.current;
    const trailEnd = respawnTrailEndRef.current;
    const trailAge = wallTime - respawnTrailStartedAtRef.current;
    const flightFadeEnd = RESPAWN_TRAIL_DURATION + 0.22;
    if (trailStart && trailEnd && trailAge >= 0 && trailAge < flightFadeEnd) {
      const flightProgress = THREE.MathUtils.clamp(trailAge / RESPAWN_TRAIL_DURATION, 0, 1);
      const flightEased = 1 - Math.pow(1 - flightProgress, 3);
      const flightOpacity = THREE.MathUtils.smoothstep(flightProgress, 0.01, 0.12)
        * (1 - THREE.MathUtils.smoothstep(trailAge, RESPAWN_TRAIL_DURATION * 0.9, flightFadeEnd));
      flightModelWorldPositionRef.current
        .copy(trailStart)
        .lerp(trailEnd, flightEased);
      flightModelOpacityRef.current = flightOpacity * 0.92;
    } else {
      flightModelWorldPositionRef.current.copy(group.position);
      flightModelOpacityRef.current = 0;
    }

    useCreatureBehaviorStore.getState().setCreaturePosition(artwork.id, [
      group.position.x,
      group.position.y,
      group.position.z
    ]);

    if (visual) {
      const splatFocus = splatUrl ? spotlightFocusRef.current : 0;
      const freeSplatMotion = splatUrl ? 1 - splatFocus : 0;
      visual.position.set(
        Math.sin(time * 0.38 + motion.phase * 0.9) * 0.06 * freeSplatMotion,
        Math.sin(time * 0.62 + motion.phase) * 0.18 * freeSplatMotion,
        Math.sin(time * 0.32 + motion.phase * 1.4) * 0.28 * freeSplatMotion
      );

      const velocity = group.position.clone().sub(lastPositionRef.current);
      const rollFromPath = THREE.MathUtils.clamp(
        tangent.x * -0.28 + tangent.z * 0.12 + velocity.x * -1.4,
        -0.22,
        0.22
      );
      const readableRoll = THREE.MathUtils.clamp(
        rollFromPath
          + basePose.rotationZ * 0.28
          + actionPose.roll * 0.12
          + Math.sin(time * 0.62 + motion.phase) * preset.rotationAmount * 0.18,
        -0.12,
        0.12
      );
      const trueYaw = Math.sin(time * 0.2 + motion.phase) * 0.24
        + actionPose.yaw * 0.42
        + tangent.x * 0.1
        + spotlightYaw;
      const truePitch = Math.sin(time * 0.18 + motion.phase * 0.7) * 0.07
        + tangent.z * 0.06
        + Math.sin(time * basePose.waveFrequency + motion.phase) * basePose.waveAmplitude * 0.04;
      const focusAmount = spotlightFocusRef.current;
      const splatPoseLock = splatUrl ? 1 : focusAmount;
      visual.rotation.set(
        THREE.MathUtils.lerp(truePitch, 0, splatPoseLock),
        THREE.MathUtils.lerp(trueYaw, 0, splatPoseLock),
        THREE.MathUtils.lerp(readableRoll, 0, splatPoseLock)
      );

      const breathAmount = THREE.MathUtils.lerp(0.045, 0.008, focusAmount);
      const breath = 1 + Math.sin(time * 1.35 + motion.phase) * breathAmount;
      const poseScale = THREE.MathUtils.lerp(
        1,
        (basePose.scaleX + basePose.scaleY + actionPose.scaleX + actionPose.scaleY) * 0.25,
        THREE.MathUtils.lerp(0.32, 0.08, focusAmount)
      );
      visual.scale.setScalar(breath * poseScale);
    }

    lastPositionRef.current.copy(group.position);

    // ── Preview image plane opacity ──
    previewMaterial.opacity = splatUrl ? 0 : spotlightFocusRef.current * 0.72;
    previewMaterial.needsUpdate = true;
  });

  return (
    <>
      <RespawnMeteorTrail
        startRef={respawnTrailStartRef}
        endRef={respawnTrailEndRef}
        startedAtRef={respawnTrailStartedAtRef}
      />
      <group ref={groupRef} renderOrder={10}>
      <group ref={visualRef}>
        {!splatUrl ? (
          <ParticleCreatureTrail
            particles={artwork.particles}
            seed={motion.seed}
            intensity={preset.trailIntensity * 0.42}
            spotlightFocusRef={spotlightFocusRef}
          />
        ) : null}

        {splatUrl ? (
          <SplatCreatureModel
            url={splatUrl}
            colors={artwork.features.visualTraits.dominantColors}
            scale={1.1}
            spotlightFocusRef={spotlightFocusRef}
            burstRef={burstRef}
            burstPhaseRef={burstPhaseRef}
            reappearRef={reappearRef}
            flightWorldPositionRef={flightModelWorldPositionRef}
            flightOpacityRef={flightModelOpacityRef}
            onReady={() => setSplatReady(true)}
            onError={(error) => {
              setSplatReady(false);
              console.warn('[triposplat] failed to render splat model:', error);
            }}
          />
        ) : null}

        {!splatUrl ? (
          <ParticleCreature
            particles={artwork.particles}
            flowAmount={preset.flowAmount * 0.62}
            breathAmount={0.018 + artwork.behaviorSignature.glow * 0.018}
            behaviorSignature={artwork.behaviorSignature}
            interactionPulseRef={pulseRef}
            burstRef={burstRef}
            spotlightFocusRef={spotlightFocusRef}
            spotlightEnabled={spotlightEnabled}
          />
        ) : null}

        {!splatUrl ? (
          <CreatureAuraDust
            particles={artwork.particles}
            width={planeWidth}
            height={planeHeight}
            seed={motion.seed}
            motionType={artwork.motionType}
            spotlightFocusRef={spotlightFocusRef}
          />
        ) : null}

        {/* Preview image plane — shows the original artwork during spotlight */}
        {!splatUrl ? (
          <mesh
            material={previewMaterial}
            renderOrder={3}
            position={[0, 0, -0.12]}
            frustumCulled={false}
          >
            <planeGeometry args={[planeWidth, planeHeight]} />
          </mesh>
        ) : null}

        <mesh
          material={interactionMaterial}
          onPointerDown={(event) => {
            event.stopPropagation();
            const now = performance.now() * 0.001;
            groupRef.current?.getWorldPosition(worldPositionScratchRef.current);
            burstAnchorRef.current = worldPositionScratchRef.current.clone();
            respawnPositionRef.current = null;
            respawnTrailStartRef.current = null;
            respawnTrailEndRef.current = null;
            respawnTrailStartedAtRef.current = -100;
            burstWasActiveRef.current = false;
            pulseStartedAtRef.current = now;
            burstStartedAtRef.current = now;
            burstPhaseRef.current = 0;
            reappearRef.current = 0;
          }}
        >
          <sphereGeometry args={[Math.max(planeWidth, planeHeight) * 0.58, 16, 10]} />
        </mesh>
      </group>
      </group>
    </>
  );
}
