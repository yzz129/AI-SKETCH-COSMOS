import { TrackballControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { CAMERA_ORBIT_TARGET } from './cosmicAnchors';
import {
  cappedDampStep,
  spotlightApproachEased,
  spotlightReleaseEased,
  spotlightReleaseProgress
} from './spotlightMotion';

const BASE_TARGET = CAMERA_ORBIT_TARGET.clone();
const CLOSE_UP_DISTANCE = 3.0;
const RELEASE_WIDE_DISTANCE = 9.6;
const SPOTLIGHT_USES_CAMERA_CLOSE_UP = false;
const AUTO_ORBIT_YAW_AMPLITUDE = THREE.MathUtils.degToRad(24);
const AUTO_ORBIT_YAW_CYCLE_SECONDS = 120;
const AUTO_ORBIT_PITCH_AMPLITUDE = THREE.MathUtils.degToRad(9);
const AUTO_ORBIT_PITCH_CYCLE_SECONDS = 145;
const AUTO_ORBIT_DOLLY_AMPLITUDE = 0.07;
const AUTO_ORBIT_DOLLY_CYCLE_SECONDS = 170;
const AUTO_ORBIT_RESUME_DELAY_MS = 1_200;

function smoothFactor(speed: number, delta: number) {
  return 1 - Math.exp(-delta * speed);
}

function moveVectorToward(
  current: THREE.Vector3,
  target: THREE.Vector3,
  smoothing: number,
  maxSpeed: number,
  delta: number
) {
  current.set(
    cappedDampStep(current.x, target.x, smoothing, maxSpeed, delta),
    cappedDampStep(current.y, target.y, smoothing, maxSpeed, delta),
    cappedDampStep(current.z, target.z, smoothing, maxSpeed, delta)
  );
}

export function CameraRig() {
  const controlsRef = useRef<any>(null);
  const defaultTarget = useRef(BASE_TARGET.clone());
  const closeUpTarget = useRef(BASE_TARGET.clone());
  const closeUpCamera = useRef(new THREE.Vector3(0, 0, 5));
  const savedCamera = useRef(new THREE.Vector3());
  const savedTarget = useRef(BASE_TARGET.clone());
  const restoreStartCamera = useRef(new THREE.Vector3());
  const restoreStartTarget = useRef(BASE_TARGET.clone());
  const scratchTarget = useRef(new THREE.Vector3());
  const releaseFollowCamera = useRef(new THREE.Vector3());
  const releaseFollowTarget = useRef(new THREE.Vector3());
  const releaseOffset = useRef(new THREE.Vector3());
  const desiredCamera = useRef(new THREE.Vector3());
  const audienceDirection = useRef(new THREE.Vector3(0, 0, 1));
  const audienceRight = useRef(new THREE.Vector3(1, 0, 0));
  const closeUpOffset = useRef(new THREE.Vector3(0, 0.28, CLOSE_UP_DISTANCE));
  const releaseWideOffset = useRef(new THREE.Vector3(0.5, 0.62, RELEASE_WIDE_DISTANCE));
  const releaseCompositionOffset = useRef(new THREE.Vector3(-0.72, 0.08, 0));
  const previousCreatureId = useRef<string | null>(null);
  const previousPhase = useRef(useSketchStore.getState().spotlight.phase);
  const hasSavedView = useRef(false);
  const hasRestoreStart = useRef(false);
  const isUserRotating = useRef(false);
  const autoOrbitResumeAt = useRef(0);
  const autoOrbitBlend = useRef(1);
  const previousAutoYaw = useRef(0);
  const previousAutoPitch = useRef(0);
  const previousAutoDistanceScale = useRef(1);
  const orbitOffset = useRef(new THREE.Vector3());
  const orbitSpherical = useRef(new THREE.Spherical());

  useFrame(({ camera, clock }, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const spotlight = useSketchStore.getState().spotlight;
    const creatureId = spotlight.creatureId;
    const phase = spotlight.phase;
    const priorPhase = previousPhase.current;
    const elapsed = spotlight.startedAt > 0 ? (Date.now() - spotlight.startedAt) / 1000 : 0;
    const isNewSpotlight = Boolean(creatureId) && creatureId !== previousCreatureId.current;

    if (isNewSpotlight) {
      savedCamera.current.copy(camera.position);
      savedTarget.current.copy(controls.target);
      defaultTarget.current.copy(controls.target);
      closeUpCamera.current.copy(camera.position);
      closeUpTarget.current.copy(controls.target);
      audienceDirection.current.copy(camera.position).sub(controls.target);
      if (audienceDirection.current.lengthSq() < 0.0001) audienceDirection.current.set(0, 0, 1);
      audienceDirection.current.normalize();
      audienceDirection.current.y = THREE.MathUtils.clamp(audienceDirection.current.y, -0.32, 0.42);
      audienceDirection.current.normalize();
      audienceRight.current.crossVectors(THREE.Object3D.DEFAULT_UP, audienceDirection.current);
      if (audienceRight.current.lengthSq() < 0.0001) audienceRight.current.set(1, 0, 0);
      else audienceRight.current.normalize();
      closeUpOffset.current.copy(audienceDirection.current).multiplyScalar(CLOSE_UP_DISTANCE)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, 0.28);
      releaseWideOffset.current.copy(audienceDirection.current).multiplyScalar(RELEASE_WIDE_DISTANCE)
        .addScaledVector(audienceRight.current, 0.5)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, 0.62);
      releaseCompositionOffset.current.copy(audienceRight.current).multiplyScalar(-0.72)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, 0.08);
      hasSavedView.current = true;
      hasRestoreStart.current = false;
    }

    if (previousPhase.current !== 'release' && phase === 'release') {
      restoreStartCamera.current.copy(camera.position);
      restoreStartTarget.current.copy(controls.target);
      hasRestoreStart.current = true;
    }

    previousCreatureId.current = creatureId;
    previousPhase.current = phase;
    controls.enabled = true;
    controls.noRotate = false;

    // Spotlight presentation now moves the creature into the outer display
    // layer. Keep the universe camera on its normal path for the entire shot.
    const isCloseUp = SPOTLIGHT_USES_CAMERA_CLOSE_UP
      && Boolean(creatureId)
      && (phase === 'fly-in' || phase === 'showcase');
    const isRelease = SPOTLIGHT_USES_CAMERA_CLOSE_UP
      && Boolean(creatureId)
      && phase === 'release';

    if (isCloseUp && creatureId) {
      const creaturePos = useCreatureBehaviorStore.getState().creaturePositions[creatureId];

      if (creaturePos) {
        scratchTarget.current.set(...creaturePos).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.08);

        if (phase === 'fly-in') {
          const eased = spotlightApproachEased(elapsed);
          desiredCamera.current.copy(scratchTarget.current).add(closeUpOffset.current);

          // TrackballControls keeps rotational velocity internally. Merely
          // setting noRotate still applies that old damping in update(), which
          // was the source of the rotating close-up. Drive the camera directly
          // for the whole shot and do not tick the controls at all.
          controls.enabled = false;
          controls.noRotate = true;
          closeUpTarget.current.lerpVectors(savedTarget.current, scratchTarget.current, eased);
          closeUpCamera.current.lerpVectors(savedCamera.current, desiredCamera.current, eased);
          // The reveal curve itself drives the camera so the shot reaches the
          // exact close-up without a final-frame snap or a second damping lag.
          controls.target.copy(closeUpTarget.current);
          camera.position.copy(closeUpCamera.current);
          camera.lookAt(closeUpTarget.current);
          camera.updateMatrixWorld();
          return;
        }

        closeUpTarget.current.copy(scratchTarget.current);
        closeUpCamera.current.copy(scratchTarget.current).add(closeUpOffset.current);
        controls.enabled = false;
        controls.noRotate = true;
        if (priorPhase === 'fly-in') {
          controls.target.copy(closeUpTarget.current);
          camera.position.copy(closeUpCamera.current);
        } else {
          moveVectorToward(controls.target, closeUpTarget.current, 5.0, 5.5, delta);
          moveVectorToward(camera.position, closeUpCamera.current, 4.2, 7.0, delta);
        }
        camera.lookAt(closeUpTarget.current);
        camera.updateMatrixWorld();
        return;
      }
    }

    if (isRelease) {
      if (!hasRestoreStart.current) {
        restoreStartCamera.current.copy(camera.position);
        restoreStartTarget.current.copy(controls.target);
        hasRestoreStart.current = true;
      }

      const rawProgress = spotlightReleaseProgress(elapsed);
      const progress = spotlightReleaseEased(elapsed);
      const targetCamera = hasSavedView.current ? savedCamera.current : camera.position;
      const targetLook = hasSavedView.current ? savedTarget.current : BASE_TARGET;
      const creaturePos = creatureId
        ? useCreatureBehaviorStore.getState().creaturePositions[creatureId]
        : undefined;

      if (creaturePos) {
        const compositionProgress = THREE.MathUtils.smootherstep(rawProgress, 0.08, 0.7);
        const restoreBlend = THREE.MathUtils.smootherstep(rawProgress, 0.7, 1);
        releaseOffset.current.lerpVectors(closeUpOffset.current, releaseWideOffset.current, progress);
        releaseFollowTarget.current.set(...creaturePos).addScaledVector(
          releaseCompositionOffset.current,
          compositionProgress
        );
        releaseFollowCamera.current.set(...creaturePos).add(releaseOffset.current);
        camera.position.lerpVectors(releaseFollowCamera.current, targetCamera, restoreBlend);
        controls.target.lerpVectors(releaseFollowTarget.current, targetLook, restoreBlend);
      } else {
        camera.position.lerpVectors(restoreStartCamera.current, targetCamera, progress);
        controls.target.lerpVectors(restoreStartTarget.current, targetLook, progress);
      }

      controls.enabled = false;
      controls.noRotate = true;
      closeUpCamera.current.copy(camera.position);
      closeUpTarget.current.copy(controls.target);
      defaultTarget.current.copy(controls.target);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      return;
    }

    if (phase === 'idle') {
      hasSavedView.current = false;
      hasRestoreStart.current = false;
      previousCreatureId.current = null;
    }

    const s = smoothFactor(1.6, delta);
    defaultTarget.current.lerp(BASE_TARGET, s);
    controls.target.copy(defaultTarget.current);
    controls.update();

    const time = clock.elapsedTime;
    const desiredYaw = Math.sin(
      time * Math.PI * 2 / AUTO_ORBIT_YAW_CYCLE_SECONDS
    ) * AUTO_ORBIT_YAW_AMPLITUDE;
    const desiredPitch = Math.sin(
      time * Math.PI * 2 / AUTO_ORBIT_PITCH_CYCLE_SECONDS
    ) * AUTO_ORBIT_PITCH_AMPLITUDE;
    const desiredDistanceScale = 1 + Math.sin(
      time * Math.PI * 2 / AUTO_ORBIT_DOLLY_CYCLE_SECONDS
    ) * AUTO_ORBIT_DOLLY_AMPLITUDE;
    const autoOrbitAllowed = phase === 'idle'
      && !isUserRotating.current
      && performance.now() >= autoOrbitResumeAt.current;
    autoOrbitBlend.current = THREE.MathUtils.damp(
      autoOrbitBlend.current,
      autoOrbitAllowed ? 1 : 0,
      autoOrbitAllowed ? 0.85 : 8,
      delta
    );

    if (autoOrbitBlend.current > 0.0001) {
      orbitOffset.current.copy(camera.position).sub(controls.target);
      orbitSpherical.current.setFromVector3(orbitOffset.current);
      orbitSpherical.current.theta += (
        desiredYaw - previousAutoYaw.current
      ) * autoOrbitBlend.current;
      orbitSpherical.current.phi = THREE.MathUtils.clamp(
        orbitSpherical.current.phi
          + (desiredPitch - previousAutoPitch.current) * autoOrbitBlend.current,
        THREE.MathUtils.degToRad(24),
        THREE.MathUtils.degToRad(156)
      );
      const distanceRatio = desiredDistanceScale
        / Math.max(previousAutoDistanceScale.current, 0.001);
      orbitSpherical.current.radius *= THREE.MathUtils.lerp(
        1,
        distanceRatio,
        autoOrbitBlend.current
      );
      orbitOffset.current.setFromSpherical(orbitSpherical.current);
      camera.position.copy(controls.target).add(orbitOffset.current);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
    }
    previousAutoYaw.current = desiredYaw;
    previousAutoPitch.current = desiredPitch;
    previousAutoDistanceScale.current = desiredDistanceScale;
  });

  return (
    <TrackballControls
      ref={controlsRef}
      makeDefault
      noPan
      noZoom
      noRotate={false}
      rotateSpeed={0.85}
      staticMoving={false}
      dynamicDampingFactor={0.22}
      target={BASE_TARGET}
      onStart={() => {
        isUserRotating.current = true;
        autoOrbitBlend.current = 0;
      }}
      onEnd={() => {
        isUserRotating.current = false;
        autoOrbitResumeAt.current = performance.now() + AUTO_ORBIT_RESUME_DELAY_MS;
      }}
    />
  );
}
