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
const AUTO_ORBIT_AMPLITUDE = THREE.MathUtils.degToRad(12);
const AUTO_ORBIT_SPEED = 0.038;
const AUTO_PITCH_AMPLITUDE = THREE.MathUtils.degToRad(5);
const AUTO_PITCH_SPEED = 0.029;
const HEARTBEAT_DOLLY_CYCLE = 8.5;
const SPOTLIGHT_USES_CAMERA_CLOSE_UP = false;

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

function heartbeatDollyScale(time: number) {
  const phase = THREE.MathUtils.euclideanModulo(time, HEARTBEAT_DOLLY_CYCLE) / HEARTBEAT_DOLLY_CYCLE;
  const pulse = (center: number, width: number) => Math.exp(-Math.pow((phase - center) / width, 2));
  const firstBeat = pulse(0.13, 0.038) * 0.16;
  const recoil = pulse(0.19, 0.035) * 0.045;
  const secondBeat = pulse(0.255, 0.052) * 0.095;
  const settle = pulse(0.36, 0.09) * 0.025;
  const outwardSwell = pulse(0.62, 0.22) * 0.16;
  const slowBreath = Math.sin(time * 0.075 + 2.35) * 0.065;

  // Larger scale means the camera is farther away. Each beat briefly pulls
  // the viewer forward, rebounds, then settles back into the wide view.
  return 1.35 + slowBreath - firstBeat + recoil - secondBeat + settle + outwardSwell;
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
  const previousAutoOrbitAngle = useRef(0);
  const previousAutoPitchAngle = useRef(0);
  const previousAutoZoomScale = useRef<number | null>(null);
  const hasAutoBaseline = useRef(false);
  const orbitOffset = useRef(new THREE.Vector3());
  const orbitRightAxis = useRef(new THREE.Vector3());

  useFrame(({ camera }, delta) => {
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

    const time = performance.now() * 0.001;
    const baseTarget = new THREE.Vector3(
      BASE_TARGET.x + Math.sin(time * 0.024) * 0.48,
      BASE_TARGET.y + Math.cos(time * 0.019 + 0.8) * 0.28,
      BASE_TARGET.z + Math.sin(time * 0.016 + 1.4) * 0.38
    );

    // Spotlight presentation now moves the creature into the outer display
    // layer. Keep the universe camera on its normal path for the entire shot.
    const isCloseUp = SPOTLIGHT_USES_CAMERA_CLOSE_UP
      && Boolean(creatureId)
      && (phase === 'fly-in' || phase === 'showcase');
    const isRelease = SPOTLIGHT_USES_CAMERA_CLOSE_UP
      && Boolean(creatureId)
      && phase === 'release';

    if (isCloseUp && creatureId) {
      previousAutoOrbitAngle.current = 0;
      previousAutoPitchAngle.current = 0;
      previousAutoZoomScale.current = null;
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
      previousAutoOrbitAngle.current = 0;
      previousAutoPitchAngle.current = 0;
      previousAutoZoomScale.current = null;
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
      if (!hasAutoBaseline.current || priorPhase !== 'idle') {
        previousAutoOrbitAngle.current = Math.sin(time * AUTO_ORBIT_SPEED) * AUTO_ORBIT_AMPLITUDE;
        previousAutoPitchAngle.current = Math.sin(time * AUTO_PITCH_SPEED + 1.1) * AUTO_PITCH_AMPLITUDE;
        previousAutoZoomScale.current = heartbeatDollyScale(time);
        hasAutoBaseline.current = true;
      }
      hasSavedView.current = false;
      hasRestoreStart.current = false;
      previousCreatureId.current = null;
    }

    const s = smoothFactor(1.6, delta);
    defaultTarget.current.lerp(baseTarget, s);
    controls.target.copy(defaultTarget.current);

    // Slowly let the whole universe drift past the viewer. Using a bounded,
    // reversible camera orbit avoids an endless 360-degree spin and preserves
    // the user's current view after manual interaction.
    const autoOrbitAngle = isUserRotating.current
      ? previousAutoOrbitAngle.current
      : Math.sin(time * AUTO_ORBIT_SPEED) * AUTO_ORBIT_AMPLITUDE;
    const autoPitchAngle = isUserRotating.current
      ? previousAutoPitchAngle.current
      : Math.sin(time * AUTO_PITCH_SPEED + 1.1) * AUTO_PITCH_AMPLITUDE;
    const autoZoomScale = isUserRotating.current
      ? (previousAutoZoomScale.current ?? 1)
      : heartbeatDollyScale(time);
    if (previousAutoZoomScale.current === null) {
      previousAutoZoomScale.current = autoZoomScale;
    }
    const autoOrbitDelta = autoOrbitAngle - previousAutoOrbitAngle.current;
    const autoPitchDelta = autoPitchAngle - previousAutoPitchAngle.current;
    const autoZoomRatio = autoZoomScale / Math.max(previousAutoZoomScale.current, 0.001);
    if (!isUserRotating.current && (
      Math.abs(autoOrbitDelta) > 0.000001
      || Math.abs(autoPitchDelta) > 0.000001
      || Math.abs(autoZoomRatio - 1) > 0.000001
    )) {
      orbitOffset.current.copy(camera.position).sub(controls.target);
      orbitOffset.current.applyAxisAngle(THREE.Object3D.DEFAULT_UP, autoOrbitDelta);
      orbitRightAxis.current.crossVectors(THREE.Object3D.DEFAULT_UP, orbitOffset.current);
      if (orbitRightAxis.current.lengthSq() > 0.000001) {
        orbitRightAxis.current.normalize();
        orbitOffset.current.applyAxisAngle(orbitRightAxis.current, autoPitchDelta);
      }
      orbitOffset.current.multiplyScalar(autoZoomRatio);
      camera.position.copy(controls.target).add(orbitOffset.current);
    }
    previousAutoOrbitAngle.current = autoOrbitAngle;
    previousAutoPitchAngle.current = autoPitchAngle;
    previousAutoZoomScale.current = autoZoomScale;
    controls.update();
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
      }}
      onEnd={() => {
        isUserRotating.current = false;
        previousAutoOrbitAngle.current = Math.sin(performance.now() * 0.001 * AUTO_ORBIT_SPEED)
          * AUTO_ORBIT_AMPLITUDE;
        previousAutoPitchAngle.current = Math.sin(performance.now() * 0.001 * AUTO_PITCH_SPEED + 1.1)
          * AUTO_PITCH_AMPLITUDE;
        previousAutoZoomScale.current = heartbeatDollyScale(performance.now() * 0.001);
      }}
    />
  );
}
