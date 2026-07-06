import { TrackballControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { CAMERA_ORBIT_TARGET } from './cosmicAnchors';

const BASE_TARGET = CAMERA_ORBIT_TARGET.clone();

/** Lerp factor for smooth camera transitions (per-frame, ~60fps). */
function smoothFactor(speed: number, delta: number) {
  return 1 - Math.exp(-delta * speed);
}

export function CameraRig() {
  const controlsRef = useRef<any>(null);
  const defaultTarget = useRef(BASE_TARGET.clone());
  const closeUpTarget = useRef(new THREE.Vector3());
  const closeUpCamera = useRef(new THREE.Vector3(0, 0, 5));
  const wasInCloseUp = useRef(false);
  const previousCloseUp = useRef(false);

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const spotlight = useSketchStore.getState().spotlight;
    const isCloseUp =
      (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase') &&
      !!spotlight.creatureId;
    controls.noRotate = false;

    const time = performance.now() * 0.001;
    const baseTarget = new THREE.Vector3(
      BASE_TARGET.x + Math.sin(time * 0.036) * 0.08,
      BASE_TARGET.y + Math.cos(time * 0.031) * 0.055,
      BASE_TARGET.z + Math.sin(time * 0.025) * 0.12,
    );

    // ── Close-up mode: camera flies to the spotlighted creature ──
    if (isCloseUp) {
      if (!previousCloseUp.current) {
        closeUpTarget.current.copy(controls.target);
        closeUpCamera.current.copy(camera.position);
      }
      previousCloseUp.current = true;
      wasInCloseUp.current = true;
      const creaturePos =
        useCreatureBehaviorStore.getState().creaturePositions[spotlight.creatureId!];

      if (creaturePos) {
        const target = new THREE.Vector3(...creaturePos).add(new THREE.Vector3(0, 0.08, 0));
        const camPos = new THREE.Vector3(
          target.x,
          target.y + 0.35,
          target.z + 2.5,
        );

        const speed = spotlight.phase === 'fly-in' ? 2.25 : 2.0;
        const s = smoothFactor(speed, delta);
        closeUpTarget.current.lerp(target, s);
        closeUpCamera.current.lerp(camPos, s);

        // Keep controls internal state tracking — prevents jump on return
        controls.target.copy(closeUpTarget.current);
        camera.position.copy(closeUpCamera.current);
        return;
      }
    }
    previousCloseUp.current = false;

    // ── Normal mode: smooth orbit ──
    // On first frame after close-up, seed the lerp for smooth return
    if (wasInCloseUp.current) {
      wasInCloseUp.current = false;
      defaultTarget.current.copy(closeUpTarget.current);
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
