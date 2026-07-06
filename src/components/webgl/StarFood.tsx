import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';

function StarFoodParticle({ id, position, createdAt }: { id: string; position: [number, number, number]; createdAt: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAge: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aPhase;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.xy += vec2(cos(uTime * 1.1 + aPhase), sin(uTime * 1.3 + aPhase)) * 0.035;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * 160.0 * (1.0 / max(-mvPosition.z, 0.01));
        vAlpha = 0.72 + sin(uTime * 2.0 + aPhase) * 0.18;
      }
    `,
    fragmentShader: `
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(0.78, 0.92, 1.0, alpha);
      }
    `
  }), []);
  const geometry = useMemo(() => {
    const count = 42;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const radius = Math.random() ** 0.55 * 0.24;
      const angle = Math.random() * Math.PI * 2;
      positions[i3] = Math.cos(angle) * radius;
      positions[i3 + 1] = Math.sin(angle) * radius * 0.72;
      positions[i3 + 2] = THREE.MathUtils.randFloatSpread(0.16);
      sizes[i] = THREE.MathUtils.randFloat(0.018, 0.045);
      phases[i] = Math.random() * Math.PI * 2;
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    return bufferGeometry;
  }, []);

  useFrame(({ clock }) => {
    const age = performance.now() * 0.001 - createdAt;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uAge.value = age;

    if (groupRef.current) {
      const fade = THREE.MathUtils.clamp(1 - age / 18, 0, 1);
      groupRef.current.scale.setScalar(0.75 + Math.sin(clock.elapsedTime * 1.2 + createdAt) * 0.08);
      groupRef.current.visible = fade > 0;
    }

    if (age > 18) {
      useCreatureBehaviorStore.getState().removeStarFood(id);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <points geometry={geometry} material={material} renderOrder={7} frustumCulled={false} />
    </group>
  );
}

export function StarFood() {
  const foods = useCreatureBehaviorStore((state) => state.foods);

  return (
    <>
      {foods.map((food) => (
        <StarFoodParticle key={food.id} {...food} />
      ))}
    </>
  );
}
