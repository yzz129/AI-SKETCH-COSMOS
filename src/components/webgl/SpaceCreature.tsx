import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { StoredArtwork } from '../../stores/artworkStore';
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

type SpaceCreatureProps = {
  artwork: StoredArtwork;
  index: number;
};

export function SpaceCreature({ artwork, index }: SpaceCreatureProps) {
  const groupRef = useRef<THREE.Group>(null);
  const visualRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number | null>(null);
  const pulseRef = useRef(0);
  const burstRef = useRef(0);
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
  const curve = useMemo(() => {
    const phase = motion.phase;
    const xBias = Math.cos(phase) * 0.65;
    const yBias = Math.sin(phase) * 0.36;
    const points = [
      new THREE.Vector3(-4.1 + xBias, -0.72 + yBias, -1.48),
      new THREE.Vector3(-1.55 + Math.sin(phase) * 0.8, 1.02 - yBias, -0.92),
      new THREE.Vector3(1.05 + Math.cos(phase * 0.7) * 0.9, 0.24 + yBias, 0.42),
      new THREE.Vector3(3.55 - xBias, -0.56 - yBias, -1.15),
      new THREE.Vector3(1.55 - Math.sin(phase) * 0.65, -1.16 + yBias, -1.55),
      new THREE.Vector3(-2.35 + xBias, 0.36 - yBias, -0.35)
    ];

    return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.45);
  }, [motion.phase]);
  const interactionMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);
  const maxSize = 0.62;
  const planeWidth = artwork.aspect >= 1 ? maxSize : maxSize * artwork.aspect;
  const planeHeight = artwork.aspect >= 1 ? maxSize / artwork.aspect : maxSize;

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
    const progress = (time * motion.speed * 0.088 + motion.phase * 0.07) % 1;
    const pathPosition = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).normalize();
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
    const depthFactor = THREE.MathUtils.mapLinear(
      THREE.MathUtils.clamp(z, -2.8, 1.2),
      -2.8,
      1.2,
      0.68,
      1.16
    );
    const entryGlow = 1 + (1 - entryProgress) * 0.2;

    group.position.set(x, y, z);
    group.scale.setScalar(motion.baseScale * 0.42 * depthFactor * entryGlow);
    useCreatureBehaviorStore.getState().setCreaturePosition(artwork.id, [x, y, z]);

    const pulseAge = wallTime - pulseStartedAtRef.current;
    pulseRef.current = pulseAge < 1.15 ? Math.sin((1 - pulseAge / 1.15) * Math.PI) * 0.9 : 0;
    const burstAge = wallTime - burstStartedAtRef.current;
    burstRef.current = burstAge < 1.35
      ? Math.sin(THREE.MathUtils.clamp(burstAge / 1.35, 0, 1) * Math.PI)
      : 0;

    if (visual) {
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
      const trueYaw = Math.sin(time * 0.34 + motion.phase) * 0.34
        + actionPose.yaw * 0.42
        + tangent.x * 0.1;
      const truePitch = Math.sin(time * 0.28 + motion.phase * 0.7) * 0.1
        + tangent.z * 0.06
        + Math.sin(time * basePose.waveFrequency + motion.phase) * basePose.waveAmplitude * 0.04;
      visual.rotation.set(truePitch, trueYaw, readableRoll);

      const breath = 1 + Math.sin(time * 1.35 + motion.phase) * 0.045;
      const poseScale = THREE.MathUtils.lerp(
        1,
        (basePose.scaleX + basePose.scaleY + actionPose.scaleX + actionPose.scaleY) * 0.25,
        0.32
      );
      visual.scale.setScalar(breath * poseScale);
    }

    lastPositionRef.current.copy(group.position);
  });

  return (
    <group ref={groupRef} renderOrder={10}>
      <group ref={visualRef}>
        <ParticleCreatureTrail
          particles={artwork.particles}
          seed={motion.seed}
          intensity={preset.trailIntensity * 0.42}
        />

        <ParticleCreature
          particles={artwork.particles}
          flowAmount={preset.flowAmount * 0.62}
          breathAmount={0.018 + artwork.behaviorSignature.glow * 0.018}
          behaviorSignature={artwork.behaviorSignature}
          interactionPulseRef={pulseRef}
          burstRef={burstRef}
        />

        <CreatureAuraDust
          particles={artwork.particles}
          width={planeWidth}
          height={planeHeight}
          seed={motion.seed}
          motionType={artwork.motionType}
        />
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
