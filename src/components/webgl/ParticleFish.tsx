import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Creature } from '../../stores/useSketchStore';
import type { SampledPoint } from '../../utils/imageSampling';

const DEFAULT_FISH_PARTICLE_COUNT = 1800;

type FishParticleData = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  seeds: Float32Array;
  brightness: Float32Array;
  edges: Float32Array;
};

function bodyRadiusAt(x: number) {
  const center = -0.08;
  const radiusX = 1.22;
  const normalized = Math.max(0, 1 - ((x - center) / radiusX) ** 2);
  const headTaper = THREE.MathUtils.smoothstep(x, 0.86, 1.2);
  return Math.sqrt(normalized) * (0.48 - headTaper * 0.13);
}

function writeParticle(
  data: FishParticleData,
  index: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
  size: number,
  seed: number,
  brightness = 0.5,
  edge = 0
) {
  const i3 = index * 3;
  data.positions[i3] = x;
  data.positions[i3 + 1] = y;
  data.positions[i3 + 2] = z;
  data.colors[i3] = color.r;
  data.colors[i3 + 1] = color.g;
  data.colors[i3 + 2] = color.b;
  data.sizes[index] = size;
  data.seeds[index] = seed;
  data.brightness[index] = brightness;
  data.edges[index] = edge;
}

function createFishParticleData(count = DEFAULT_FISH_PARTICLE_COUNT): FishParticleData {
  const data: FishParticleData = {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    seeds: new Float32Array(count),
    brightness: new Float32Array(count),
    edges: new Float32Array(count)
  };

  const cyan = new THREE.Color('#6eeaff');
  const blue = new THREE.Color('#1776ff');
  const violet = new THREE.Color('#815cff');
  const pearl = new THREE.Color('#dffcff');
  const gold = new THREE.Color('#ffe07a');

  for (let i = 0; i < count; i += 1) {
    const section = i / count;
    const seed = Math.random() * 1000;
    let x = 0;
    let y = 0;
    let z = (Math.random() - 0.5) * 0.08;
    let color = cyan.clone().lerp(blue, Math.random() * 0.42);
    let size = 0.18 + Math.random() * 0.18;

    if (section < 0.5) {
      const t = Math.random();
      x = THREE.MathUtils.lerp(-1.17, 1.18, t);
      const edge = Math.random() > 0.5 ? 1 : -1;
      y = bodyRadiusAt(x) * edge;
      x += (Math.random() - 0.5) * 0.018;
      y += (Math.random() - 0.5) * 0.035;
      size *= 1.08;
    } else if (section < 0.7) {
      const edge = Math.random() > 0.5 ? 1 : -1;
      const t = Math.random();
      x = THREE.MathUtils.lerp(-1.18, -1.88, t);
      y = THREE.MathUtils.lerp(edge * 0.28, 0, t) + (Math.random() - 0.5) * 0.045;
      z += (Math.random() - 0.5) * 0.04;
      color = violet.clone().lerp(cyan, Math.random() * 0.35);
    } else if (section < 0.88) {
      const t = Math.random();
      const band = Math.floor(Math.random() * 5) / 4;
      x = THREE.MathUtils.lerp(-0.92, 0.92, t);
      y = THREE.MathUtils.lerp(-0.68, 0.68, band) * bodyRadiusAt(x);
      y += Math.sin(t * Math.PI * 2.4 + band * 1.8) * 0.025;
      color = cyan.clone().lerp(pearl, 0.25 + Math.random() * 0.48);
      size *= 0.78;
    } else if (section < 0.96) {
      const finSide = Math.random() > 0.5 ? 1 : -1;
      const t = Math.random();
      x = THREE.MathUtils.lerp(-0.16, -0.62, t);
      y = finSide * THREE.MathUtils.lerp(0.22, 0.78, t);
      y += (Math.random() - 0.5) * 0.04;
      color = violet.clone().lerp(blue, Math.random() * 0.4);
      size *= 0.88;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() ** 0.5;
      x = 0.78 + Math.cos(angle) * radius * 0.11;
      y = 0.16 + Math.sin(angle) * radius * 0.11;
      z = 0.07 + Math.random() * 0.03;
      color = gold.clone().lerp(pearl, Math.random() * 0.28);
      size *= 0.65;
    }

    writeParticle(data, i, x, y, z, color, size, seed, 0.54, section < 0.7 ? 0.8 : 0.25);
  }

  return data;
}

function createShapeParticleData(points: SampledPoint[], tint = '#7de7ff'): FishParticleData {
  const count = Math.max(points.length, 1);
  const data: FishParticleData = {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    seeds: new Float32Array(count),
    brightness: new Float32Array(count),
    edges: new Float32Array(count)
  };

  const fallbackColor = new THREE.Color(tint);

  for (let i = 0; i < count; i += 1) {
    const sourcePoint = points[i];
    const color = sourcePoint
      ? new THREE.Color(sourcePoint.color[0], sourcePoint.color[1], sourcePoint.color[2])
      : fallbackColor;
    const edge = sourcePoint?.edge ?? 0;
    const brightness = sourcePoint?.brightness ?? 0.5;
    const scatter = sourcePoint?.scatter ?? 0.002;
    const x = (sourcePoint?.x ?? 0) + (Math.random() - 0.5) * scatter;
    const y = (sourcePoint?.y ?? 0) + (Math.random() - 0.5) * scatter;
    const z = (sourcePoint?.z ?? 0) + (Math.random() - 0.5) * 0.012;
    const boostedColor = color.lerp(fallbackColor, edge > 0.18 ? 0.08 : 0.16);
    const size = 0.018 + Math.random() * 0.008 + Math.min(edge, 1) * 0.012;

    writeParticle(data, i, x, y, z, boostedColor, size, Math.random() * 1000, brightness, edge);
  }

  return data;
}

function createParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 color;
      attribute float size;
      attribute float seed;
      attribute float brightness;
      attribute float edge;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float tailInfluence = smoothstep(0.35, -1.9, p.x);
        float bodyWave = sin(uTime * 1.4 + p.x * 4.4 + seed) * 0.008;
        float tailWave = sin(uTime * 3.6 + p.x * 7.2 + seed) * 0.018 * tailInfluence;
        float edgeDrift = edge * sin(uTime * 1.05 + seed + p.y * 6.0) * 0.012;
        float shimmer = sin(uTime * 2.0 + seed * 1.7) * (0.004 + edge * 0.006);

        p.x += edgeDrift * 0.45;
        p.y += bodyWave + tailWave + edgeDrift;
        p.z += shimmer + cos(uTime * 1.6 + seed + p.y * 5.0) * (0.025 + edge * 0.035);

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * 64.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01)) * (0.85 + edge * 0.26);

        vColor = color * (0.82 + (1.0 - brightness) * 0.22 + edge * 0.32);
        vAlpha = 0.66 + edge * 0.22 + sin(uTime * 1.7 + seed) * 0.06;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
}

type ParticleFishProps = {
  creature?: Creature;
  idleIndex?: number;
};

export function ParticleFish({ creature, idleIndex = 0 }: ParticleFishProps) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const initialPosition = useMemo<THREE.Vector3>(() => (
    creature
      ? new THREE.Vector3(...creature.position)
      : new THREE.Vector3(-3.3 - idleIndex * 1.15, -0.72 + idleIndex * 0.52, -0.45 + idleIndex * 0.32)
  ), [creature, idleIndex]);
  const velocity = useMemo<THREE.Vector3>(() => (
    creature ? new THREE.Vector3(...creature.velocity) : new THREE.Vector3(0.12 + idleIndex * 0.035, 0, 0)
  ), [creature, idleIndex]);
  const particleData = useMemo(() => (
    creature?.points.length ? createShapeParticleData(creature.points) : createFishParticleData()
  ), [creature]);
  const material = useMemo(createParticleMaterial, []);

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = time;
    }

    const group = groupRef.current;
    if (!group) return;

    const lanePhase = creature ? creature.lane * 0.9 : idleIndex * 1.3;

    if (creature) {
      group.position.x = initialPosition.x + Math.sin(time * 0.18 + lanePhase) * 0.12 + velocity.x * Math.sin(time * 0.09 + lanePhase) * 2.5;
      group.position.y = initialPosition.y + Math.sin(time * 0.24 + lanePhase) * 0.16;
      group.position.z = initialPosition.z + Math.sin(time * 0.2 + lanePhase) * 0.22;
      group.rotation.z = Math.sin(time * 0.26 + lanePhase) * 0.045;
      group.rotation.y = Math.sin(time * 0.16 + lanePhase) * 0.08;
    } else {
      group.position.x += velocity.x * delta;
      group.position.y = initialPosition.y + Math.sin(time * 0.28 + lanePhase) * 0.24;
      group.position.z = initialPosition.z + Math.sin(time * 0.22 + lanePhase) * 0.32;
      group.rotation.z = Math.sin(time * 0.32 + lanePhase) * 0.12;
      group.rotation.y = Math.sin(time * 0.18 + lanePhase) * 0.18;

      if (velocity.x > 0 && group.position.x > 4.9) {
        group.position.x = -4.9;
      } else if (velocity.x < 0 && group.position.x < -4.9) {
        group.position.x = 4.9;
      }
    }
  });

  return (
    <group ref={groupRef} position={initialPosition} scale={creature ? creature.scale : 0.82 + idleIndex * 0.08}>
      <points key={creature?.id ?? `default-fish-${idleIndex}`} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particleData.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[particleData.colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[particleData.sizes, 1]} />
          <bufferAttribute attach="attributes-seed" args={[particleData.seeds, 1]} />
          <bufferAttribute attach="attributes-brightness" args={[particleData.brightness, 1]} />
          <bufferAttribute attach="attributes-edge" args={[particleData.edges, 1]} />
        </bufferGeometry>
        <primitive ref={materialRef} object={material} attach="material" />
      </points>
    </group>
  );
}
