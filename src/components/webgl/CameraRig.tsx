import { TrackballControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { CAMERA_ORBIT_TARGET } from './cosmicAnchors';
import {
  SPOTLIGHT_FLY_IN_DURATION,
  SPOTLIGHT_RELEASE_DURATION,
  SPOTLIGHT_SHOWCASE_DURATION
} from './spotlightConfig';

const BASE_TARGET = CAMERA_ORBIT_TARGET.clone();
const CLOSE_UP_OFFSET = new THREE.Vector3(0, 0.32, 2.35);
const CLOSE_UP_LOOK_OFFSET = new THREE.Vector3(0, 0.08, 0);

function smoothFactor(speed: number, delta: number) {
  return 1 - Math.exp(-delta * speed);
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
  const previousCreatureId = useRef<string | null>(null);
  const previousPhase = useRef(useSketchStore.getState().spotlight.phase);
  const hasSavedView = useRef(false);
  const hasRestoreStart = useRef(false);

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const spotlight = useSketchStore.getState().spotlight;
    const creatureId = spotlight.creatureId;
    const phase = spotlight.phase;
    const elapsed = spotlight.startedAt > 0 ? (Date.now() - spotlight.startedAt) / 1000 : 0;
    const isNewSpotlight = Boolean(creatureId) && creatureId !== previousCreatureId.current;

    if (isNewSpotlight) {
      savedCamera.current.copy(camera.position);
      savedTarget.current.copy(controls.target);
      defaultTarget.current.copy(controls.target);
      closeUpCamera.current.copy(camera.position);
      closeUpTarget.current.copy(controls.target);
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
      BASE_TARGET.x + Math.sin(time * 0.036) * 0.08,
      BASE_TARGET.y + Math.cos(time * 0.031) * 0.055,
      BASE_TARGET.z + Math.sin(time * 0.025) * 0.12
    );

    const isCloseUp = Boolean(creatureId) && (phase === 'fly-in' || phase === 'showcase');
    const isRelease = Boolean(creatureId) && phase === 'release';

    if (isCloseUp && creatureId) {
      const creaturePos = useCreatureBehaviorStore.getState().creaturePositions[creatureId];

      if (creaturePos) {
        scratchTarget.current.set(...creaturePos).add(CLOSE_UP_LOOK_OFFSET);

        if (phase === 'fly-in') {
          const flyProgress = THREE.MathUtils.clamp(elapsed / SPOTLIGHT_FLY_IN_DURATION, 0, 1);
          const eased = 1 - Math.pow(1 - flyProgress, 3);
          const camPos = scratchTarget.current.clone().add(CLOSE_UP_OFFSET);
          const s = Math.max(smoothFactor(3.2, delta), eased * 0.045);

          controls.noRotate = true;
          closeUpTarget.current.lerp(scratchTarget.current, s);
          closeUpCamera.current.lerp(camPos, s);
          controls.target.copy(closeUpTarget.current);
          camera.position.copy(closeUpCamera.current);
          controls.update();
          return;
        }

        closeUpTarget.current.lerp(scratchTarget.current, smoothFactor(5.5, delta));
        controls.target.copy(closeUpTarget.current);
        controls.noRotate = false;
        controls.update();
        return;
      }
    }

    if (isRelease) {
      if (!hasRestoreStart.current) {
        restoreStartCamera.current.copy(camera.position);
        restoreStartTarget.current.copy(controls.target);
        hasRestoreStart.current = true;
      }

      const releaseStart = SPOTLIGHT_FLY_IN_DURATION + SPOTLIGHT_SHOWCASE_DURATION;
      const rawProgress = THREE.MathUtils.clamp((elapsed - releaseStart) / SPOTLIGHT_RELEASE_DURATION, 0, 1);
      const progress = THREE.MathUtils.smoothstep(rawProgress, 0, 1);
      const targetCamera = hasSavedView.current ? savedCamera.current : camera.position;
      const targetLook = hasSavedView.current ? savedTarget.current : BASE_TARGET;

      controls.noRotate = true;
      camera.position.lerpVectors(restoreStartCamera.current, targetCamera, progress);
      controls.target.lerpVectors(restoreStartTarget.current, targetLook, progress);
      closeUpCamera.current.copy(camera.position);
      closeUpTarget.current.copy(controls.target);
      defaultTarget.current.copy(controls.target);
      controls.update();
      return;
    }

    if (phase === 'idle') {
      hasSavedView.current = false;
      hasRestoreStart.current = false;
      previousCreatureId.current = null;
    }

    const s = smoothFactor(1.6, delta);
    defaultTarget.current.lerp(baseTarget, s);
    controls.target.copy(defaultTarget.current);
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
    />
  );
}
