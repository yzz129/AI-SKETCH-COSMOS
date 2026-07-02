import { TrackballControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

const baseTarget = new THREE.Vector3(0, 0.05, -6);

export function CameraRig() {
  const controlsRef = useRef<any>(null);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const time = performance.now() * 0.001;
    controls.target.set(
      baseTarget.x + Math.sin(time * 0.036) * 0.08,
      baseTarget.y + Math.cos(time * 0.031) * 0.055,
      baseTarget.z + Math.sin(time * 0.025) * 0.12,
    );
    controls.update();
  });

  return (
    <TrackballControls
      ref={controlsRef}
      makeDefault
      noPan
      noZoom
      noRotate={false}
      rotateSpeed={2.25}
      staticMoving={false}
      dynamicDampingFactor={0.075}
      target={baseTarget}
    />
  );
}
