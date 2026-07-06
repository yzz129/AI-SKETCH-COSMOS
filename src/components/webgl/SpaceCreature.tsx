import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
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

export function SpaceCreature({ artwork, index }: SpaceCreatureProps) {
  const spotlightCreatureId = useSketchStore((state) => state.spotlight.creatureId);
  const spotlightPhase = useSketchStore((state) => state.spotlight.phase);
  const groupRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number | null>(null);
  const pulseRef = useRef(0);
  const burstRef = useRef(0);
  const spotlightFocusRef = useRef(0);
  const spotlightAnchorRef = useRef<THREE.Vector3 | null>(null);
  const wasSpotlightRef = useRef(false);
  const pulseStartedAtRef = useRef(-100);
  const burstStartedAtRef = useRef(-100);
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
    useCreatureBehaviorStore.getState().setCreaturePosition(artwork.id, [
      group.position.x,
      group.position.y,
      group.position.z
    ]);

    const pulseAge = wallTime - pulseStartedAtRef.current;
    pulseRef.current = pulseAge < 1.15 ? Math.sin((1 - pulseAge / 1.15) * Math.PI) * 0.9 : 0;
    const burstAge = wallTime - burstStartedAtRef.current;
    burstRef.current = burstAge < 1.35
      ? Math.sin(THREE.MathUtils.clamp(burstAge / 1.35, 0, 1) * Math.PI)
      : 0;

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
            pulseStartedAtRef.current = now;
            burstStartedAtRef.current = now;
          }}
        >
          <sphereGeometry args={[Math.max(planeWidth, planeHeight) * 0.58, 16, 10]} />
        </mesh>
      </group>
    </group>
  );
}
