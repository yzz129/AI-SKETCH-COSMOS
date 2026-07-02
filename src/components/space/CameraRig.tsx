import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

export function CameraRig() {
  const { camera } = useThree();
  const base = useMemo(() => new THREE.Vector3(0, 0, 8.5), []);
  const lookAt = useMemo(() => new THREE.Vector3(0.12, -0.08, -8), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    camera.position.set(
      base.x + Math.sin(t * 0.055) * 0.16,
      base.y + Math.cos(t * 0.047) * 0.08,
      base.z + Math.sin(t * 0.033) * 0.14
    );
    camera.lookAt(lookAt.x + Math.sin(t * 0.038) * 0.12, lookAt.y + Math.cos(t * 0.041) * 0.08, lookAt.z);
  });

  return null;
}
