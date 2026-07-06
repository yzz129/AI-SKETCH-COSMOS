import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CosmicPoints, createCosmicParticleMaterial, createParticleData, type ParticleData, writeParticle } from './cosmicShared';

type FloatingDustData = ParticleData & {
  speeds: Float32Array;
  verticalSpeeds: Float32Array;
  phases: Float32Array;
};

const DUST_BOUNDS = {
  x: 9,
  y: 5,
  z: 3.5
} as const;

function wrap(value: number, min: number, max: number) {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

function createFloatingDust(count: number): FloatingDustData {
  const data = createParticleData(count);
  const dustData: FloatingDustData = {
    ...data,
    speeds: new Float32Array(count),
    verticalSpeeds: new Float32Array(count),
    phases: new Float32Array(count)
  };
  const cyan = new THREE.Color('#8bf2ff');
  const purple = new THREE.Color('#c59aff');
  const pink = new THREE.Color('#ff8ee8');
  const columns = Math.ceil(Math.sqrt(count * (DUST_BOUNDS.x / DUST_BOUNDS.y)));
  const rows = Math.ceil(count / columns);
  const cellWidth = (DUST_BOUNDS.x * 2) / columns;
  const cellHeight = (DUST_BOUNDS.y * 2) / rows;

  for (let i = 0; i < count; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const layer = Math.random();
    const z = THREE.MathUtils.lerp(-2.8, -DUST_BOUNDS.z, layer);
    const x = -DUST_BOUNDS.x + (column + Math.random()) * cellWidth;
    const y = -DUST_BOUNDS.y + (row + Math.random()) * cellHeight;
    const color = cyan.clone().lerp(purple, Math.random() * 0.72).lerp(pink, Math.random() * 0.24);
    writeParticle(dustData, i, new THREE.Vector3(x, y, z), color, 34 + Math.random() * 82, Math.random() * Math.PI * 2, {
      distance: 8 + layer * 14,
      brightness: 0.52 + Math.random() * 0.48,
      twinklePeriod: 3.1 + Math.random() * 4.8,
      twinkleAmplitude: 0.1 + Math.random() * 0.13,
      temperature: 7800
    });
    dustData.speeds[i] = 0.045 + layer * 0.055 + Math.random() * 0.025;
    dustData.verticalSpeeds[i] = THREE.MathUtils.randFloatSpread(0.018);
    dustData.phases[i] = Math.random() * Math.PI * 2;
  }

  return dustData;
}

export function FloatingDust() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const data = useMemo(() => createFloatingDust(420), []);
  const material = useMemo(() => {
    const shader = createCosmicParticleMaterial({ opacity: 0.46, twinkle: 0.86, soft: true, cloudFlow: 0.028 });
    materialRef.current = shader;
    return shader;
  }, []);

  useFrame(({ clock }, delta) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    if (!pointsRef.current) return;
    const positionAttribute = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;

    for (let i = 0; i < data.speeds.length; i += 1) {
      const i3 = i * 3;
      positions[i3] = wrap(positions[i3] - delta * data.speeds[i], -DUST_BOUNDS.x, DUST_BOUNDS.x);
      positions[i3 + 1] = wrap(
        positions[i3 + 1] + delta * data.verticalSpeeds[i] + Math.sin(clock.elapsedTime * 0.22 + data.phases[i]) * delta * 0.012,
        -DUST_BOUNDS.y,
        DUST_BOUNDS.y
      );
      positions[i3 + 2] = wrap(positions[i3 + 2], -DUST_BOUNDS.z, -2.8);
    }

    positionAttribute.needsUpdate = true;
    pointsRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.08) * 0.035;
    pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.05) * 0.018;
  });

  return <CosmicPoints data={data} material={material} pointsRef={pointsRef} />;
}
