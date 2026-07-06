import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export function TestSphere() {
  const sphereRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const sphere = sphereRef.current;
    if (!sphere) return;

    sphere.rotation.x = clock.elapsedTime * 0.16;
    sphere.rotation.y = clock.elapsedTime * 0.28;
  });

  return (
    <group>
      <Sparkles count={70} scale={[7, 3.4, 3]} size={2.1} speed={0.26} color="#7de7ff" opacity={0.42} />
      <Float speed={1.1} rotationIntensity={0.18} floatIntensity={0.36}>
        <mesh ref={sphereRef} position={[0, 0, 0]} castShadow>
          <sphereGeometry args={[1.05, 96, 96]} />
          <MeshDistortMaterial
            color="#12b8d7"
            emissive="#064f78"
            emissiveIntensity={0.58}
            roughness={0.28}
            metalness={0.2}
            distort={0.2}
            speed={1.3}
          />
        </mesh>
      </Float>
    </group>
  );
}
