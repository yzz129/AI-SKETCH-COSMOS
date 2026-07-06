import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type Spark = {
  position: [number, number, number];
  scale: number;
  color: string;
  phase: number;
};

const SPARKS: Spark[] = [
  { position: [-0.34, -0.08, -4.9], scale: 0.08, color: '#64d9ff', phase: 0.3 },
  { position: [-2.55, -0.46, -5.8], scale: 0.062, color: '#f7d6ff', phase: 1.4 },
  { position: [2.92, 1.72, -6.4], scale: 0.052, color: '#f7d6ff', phase: 2.2 },
  { position: [5.42, -1.54, -6.1], scale: 0.088, color: '#f7d6ff', phase: 3.1 },
  { position: [-5.84, 0.96, -7.2], scale: 0.056, color: '#64d9ff', phase: 4.2 },
  { position: [1.16, -2.74, -5.5], scale: 0.05, color: '#7b4dff', phase: 5.1 },
  { position: [-4.74, 3.02, -8.3], scale: 0.062, color: '#f7d6ff', phase: 1.9 },
  { position: [4.24, 2.56, -9.2], scale: 0.044, color: '#64d9ff', phase: 2.9 }
];

export function TwinkleStars() {
  return (
    <group>
      {SPARKS.map((spark) => (
        <StarSpark key={`${spark.position.join(',')}-${spark.phase}`} {...spark} />
      ))}
    </group>
  );
}

function StarSpark({ position, scale, color, phase }: Spark) {
  const ref = useRef<THREE.Group>(null);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [color]
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = 0.72 + Math.sin(clock.elapsedTime * 1.4 + phase) * 0.22;
    ref.current.scale.setScalar(scale * pulse);
    ref.current.rotation.z = clock.elapsedTime * 0.18 + phase;
  });

  return (
    <group ref={ref} position={position}>
      <mesh material={material}>
        <planeGeometry args={[1.8, 0.035]} />
      </mesh>
      <mesh material={material} rotation={[0, 0, Math.PI / 2]}>
        <planeGeometry args={[1.8, 0.035]} />
      </mesh>
      <mesh material={material} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.82, 0.024]} />
      </mesh>
      <mesh material={material} rotation={[0, 0, -Math.PI / 4]}>
        <planeGeometry args={[0.82, 0.024]} />
      </mesh>
      <mesh material={material}>
        <circleGeometry args={[0.16, 18]} />
      </mesh>
    </group>
  );
}
