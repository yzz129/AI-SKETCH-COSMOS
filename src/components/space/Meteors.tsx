import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type Meteor = {
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  duration: number;
  delay: number;
  length: number;
  width: number;
};

export function Meteors() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {},
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float tail = smoothstep(0.0, 0.9, vUv.x);
            float head = smoothstep(0.72, 1.0, vUv.x);
            float center = 1.0 - abs(vUv.y - 0.5) * 2.0;
            float alpha = pow(max(center, 0.0), 1.8) * tail;
            vec3 color = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.84, 1.0), head);
            gl_FragColor = vec4(color, alpha * (0.72 + head * 0.6));
          }
        `
      }),
    []
  );
  const meteors = useMemo<Meteor[]>(
    () => [
      {
        start: new THREE.Vector3(-5.6, 3.2, -5.8),
        velocity: new THREE.Vector3(3.4, -2.1, -0.18),
        duration: 2.6,
        delay: 0.2,
        length: 1.72,
        width: 0.028
      },
      {
        start: new THREE.Vector3(5.8, 2.65, -7.4),
        velocity: new THREE.Vector3(-2.8, -2.0, 0.08),
        duration: 2.8,
        delay: 3.8,
        length: 1.48,
        width: 0.023
      },
      {
        start: new THREE.Vector3(-1.2, 1.64, -6.2),
        velocity: new THREE.Vector3(2.2, -2.55, -0.05),
        duration: 2.25,
        delay: 7.6,
        length: 1.35,
        width: 0.02
      },
      {
        start: new THREE.Vector3(2.3, 3.7, -9.5),
        velocity: new THREE.Vector3(-2.7, -1.95, 0.04),
        duration: 2.45,
        delay: 11.3,
        length: 1.65,
        width: 0.025
      }
    ],
    []
  );
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    meteors.forEach((meteor, index) => {
      const loop = 14.8;
      const local = (clock.elapsedTime + meteor.delay) % loop;
      const active = local < meteor.duration;
      const progress = THREE.MathUtils.clamp(local / meteor.duration, 0, 1);
      const fade = active
        ? THREE.MathUtils.smoothstep(progress, 0.02, 0.18) * (1 - THREE.MathUtils.smoothstep(progress, 0.72, 1))
        : 0;

      position.copy(meteor.start).addScaledVector(meteor.velocity, Math.min(local, meteor.duration));
      direction.copy(meteor.velocity).normalize();
      position.addScaledVector(direction, -meteor.length * 0.5 * fade);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(direction.y, direction.x));
      scale.set(meteor.length * fade, meteor.width * (0.35 + fade), 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, meteors.length]} frustumCulled={false} raycast={() => null}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}
