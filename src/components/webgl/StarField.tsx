import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  apparentBrightness,
  colorFromTemperature,
  CosmicPoints,
  createCosmicParticleMaterial,
  createParticleData,
  type ParticleData,
  writeParticle
} from './cosmicShared';

const STAR_BOUNDS = {
  x: 24,
  y: 13,
  z: [-78, -16]
} as const;

function createDistantStars(count: number): ParticleData {
  const data = createParticleData(count);
  const columns = Math.ceil(Math.sqrt(count * (STAR_BOUNDS.x / STAR_BOUNDS.y)));
  const rows = Math.ceil(count / columns);
  const cellWidth = (STAR_BOUNDS.x * 2) / columns;
  const cellHeight = (STAR_BOUNDS.y * 2) / rows;

  for (let i = 0; i < count; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const distance = 16 + Math.random() ** 0.58 * 62;
    const giantStar = Math.random() > 0.955;
    const absoluteLuminosity = giantStar
      ? THREE.MathUtils.randFloat(48, 120)
      : 0.35 + Math.random() ** 5.8 * 42;
    const brightness = apparentBrightness(absoluteLuminosity, distance / 10);
    const temperature = THREE.MathUtils.randFloat(3200, 10800);
    const twinklePeriod = THREE.MathUtils.lerp(0.7, 4.8, Math.random() ** 1.7);
    const atmosphericFactor = THREE.MathUtils.clamp(1.25 - distance / 70 + Math.random() * 0.25, 0.22, 1);
    const twinkleAmplitude = THREE.MathUtils.clamp(
      (0.08 + Math.random() * 0.32) * atmosphericFactor / Math.sqrt(brightness + 0.15),
      0.035,
      0.42
    );
    const position = new THREE.Vector3(
      -STAR_BOUNDS.x + (column + Math.random()) * cellWidth,
      -STAR_BOUNDS.y + (row + Math.random()) * cellHeight,
      THREE.MathUtils.clamp(-distance, STAR_BOUNDS.z[0], STAR_BOUNDS.z[1])
    );

    const color = colorFromTemperature(temperature).lerp(new THREE.Color('#bba9ff'), Math.random() * 0.16);
    const size = THREE.MathUtils.clamp(14 + brightness * 48 + Math.random() * 14 + (giantStar ? 34 : 0), 10, 92);
    writeParticle(data, i, position, color, size, Math.random() * Math.PI * 2, {
      distance: Math.abs(position.z),
      brightness,
      twinklePeriod,
      twinkleAmplitude,
      temperature
    });
  }

  return data;
}

export function StarField() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const stars = useMemo(() => createDistantStars(6200), []);
  const material = useMemo(() => {
    const shader = createCosmicParticleMaterial({ opacity: 0.98, twinkle: 1.75, soft: false });
    materialRef.current = shader;
    return shader;
  }, []);

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.018) * 0.014;
    pointsRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.025) * 0.018;
  });

  return <CosmicPoints data={stars} material={material} pointsRef={pointsRef} />;
}
