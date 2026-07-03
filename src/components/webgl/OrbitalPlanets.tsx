import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

type PlanetSpec = {
  position: [number, number, number];
  radius: number;
  color: string;
  accent: string;
  ring?: boolean;
  moon?: boolean;
  orbitSpeed: number;
  spinSpeed: number;
  floatAmount: number;
  phase: number;
};

type ParticleLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

const PLANETS: PlanetSpec[] = [
  { position: [-4.9, 2.05, -6.2], radius: 0.26, color: '#4ad7ff', accent: '#7b4dff', ring: true, moon: true, orbitSpeed: 0.18, spinSpeed: 0.55, floatAmount: 0.24, phase: 0.4 },
  { position: [4.8, 1.62, -6.8], radius: 0.34, color: '#f2913c', accent: '#ffe8b8', ring: true, orbitSpeed: -0.13, spinSpeed: 0.38, floatAmount: 0.18, phase: 1.7 },
  { position: [-5.6, -1.65, -5.2], radius: 0.18, color: '#d76bff', accent: '#64d9ff', moon: true, orbitSpeed: 0.24, spinSpeed: 0.72, floatAmount: 0.2, phase: 3.1 },
  { position: [5.7, -1.82, -5.8], radius: 0.22, color: '#7b4dff', accent: '#f3a6ff', orbitSpeed: -0.21, spinSpeed: 0.48, floatAmount: 0.16, phase: 4.4 }
];

function seededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeParticleMaterial(scale = 620) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uScale: { value: scale },
      uBurstProgress: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uScale;
      uniform float uBurstProgress;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec3 p = position;
        p += normalize(position + vec3(0.0001)) * sin(uTime * 0.82 + aPhase) * 0.008;
        vec3 burstDirection = normalize(position + vec3(
          sin(aPhase * 2.1),
          cos(aPhase * 1.7),
          sin(aPhase * 1.3 + 1.2)
        ) * 0.035 + vec3(0.0001));
        float burstNoise = 0.78 + 0.48 * sin(aPhase * 4.7 + uTime * 0.9);
        p += burstDirection * uBurstProgress * burstNoise * 0.78;
        p += vec3(
          sin(aPhase + uTime * 5.4),
          cos(aPhase * 0.8 + uTime * 4.8),
          sin(aPhase * 1.2 + uTime * 5.1)
        ) * uBurstProgress * 0.035;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float pulse = 0.82 + 0.18 * sin(uTime * 1.08 + aPhase);
        gl_PointSize = aSize * pulse * (1.0 + uBurstProgress * 1.25) * uScale * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * pulse * (1.0 + uBurstProgress * 0.7);
        vDepth = -mvPosition.z;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = smoothstep(0.24, 0.0, d);
        float halo = smoothstep(0.54, 0.02, d) * 0.38;
        float alpha = (core + halo) * vAlpha;
        alpha *= 1.0 - smoothstep(10.0, 28.0, vDepth) * 0.2;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
}

function writeParticle(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alphas: Float32Array,
  phases: Float32Array,
  index: number,
  position: THREE.Vector3,
  color: THREE.Color,
  size: number,
  alpha: number,
  phase: number
) {
  const i3 = index * 3;
  positions[i3] = position.x;
  positions[i3 + 1] = position.y;
  positions[i3 + 2] = position.z;
  colors[i3] = color.r;
  colors[i3 + 1] = color.g;
  colors[i3 + 2] = color.b;
  sizes[index] = size;
  alphas[index] = alpha;
  phases[index] = phase;
}

function createPlanetParticles(spec: PlanetSpec, seed: number): ParticleLayer {
  const random = seededRandom(seed);
  const shellCount = Math.round(1300 + spec.radius * 2600);
  const glowCount = Math.round(280 + spec.radius * 700);
  const count = shellCount + glowCount;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const base = new THREE.Color(spec.color);
  const accent = new THREE.Color(spec.accent);
  const highlight = new THREE.Color('#f7f3ff');

  for (let i = 0; i < shellCount; i += 1) {
    const u = random();
    const v = random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const shellBias = random() < 0.78 ? 1 : random() ** 0.22;
    const radius = spec.radius * THREE.MathUtils.lerp(0.42, 1.02, shellBias);
    const latitudeShade = 0.5 + 0.5 * Math.sin(phi * 5.0 + spec.phase);
    const color = base.clone().lerp(accent, latitudeShade * 0.38 + random() * 0.16);

    if (random() > 0.82) color.lerp(highlight, random() * 0.22);

    const position = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius,
      Math.sin(phi) * Math.sin(theta) * radius
    );

    writeParticle(
      positions,
      colors,
      sizes,
      alphas,
      phases,
      i,
      position,
      color,
      THREE.MathUtils.lerp(0.011, 0.028, random() ** 0.65),
      THREE.MathUtils.lerp(0.18, 0.58, random() ** 0.8),
      random() * Math.PI * 2
    );
  }

  for (let i = 0; i < glowCount; i += 1) {
    const index = shellCount + i;
    const angle = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = spec.radius * THREE.MathUtils.lerp(1.02, 1.42, random() ** 0.65);
    const position = new THREE.Vector3(Math.cos(angle) * ring * radius, z * radius, Math.sin(angle) * ring * radius);
    const color = accent.clone().lerp(highlight, random() * 0.12);

    writeParticle(
      positions,
      colors,
      sizes,
      alphas,
      phases,
      index,
      position,
      color,
      THREE.MathUtils.lerp(0.015, 0.04, random() ** 1.3),
      THREE.MathUtils.lerp(0.045, 0.14, random()),
      random() * Math.PI * 2
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: makeParticleMaterial(680) };
}

function createRingParticles(spec: PlanetSpec, seed: number): ParticleLayer {
  const random = seededRandom(seed);
  const count = Math.round(720 + spec.radius * 1200);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const base = new THREE.Color(spec.accent);
  const highlight = new THREE.Color('#f7f3ff');

  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = spec.radius * THREE.MathUtils.lerp(1.28, 2.08, random());
    const band = THREE.MathUtils.randFloatSpread(spec.radius * 0.12);
    const position = new THREE.Vector3(Math.cos(angle) * radius, band, Math.sin(angle) * radius * 0.72);
    const color = base.clone().lerp(highlight, random() * 0.2);

    writeParticle(
      positions,
      colors,
      sizes,
      alphas,
      phases,
      i,
      position,
      color,
      THREE.MathUtils.lerp(0.008, 0.024, random() ** 0.75),
      THREE.MathUtils.lerp(0.08, 0.32, random()),
      random() * Math.PI * 2
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: makeParticleMaterial(560) };
}

function createMoonParticles(spec: PlanetSpec, seed: number): ParticleLayer {
  const random = seededRandom(seed);
  const count = 240;
  const moonRadius = spec.radius * 0.18;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const base = new THREE.Color(spec.accent);

  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = moonRadius * THREE.MathUtils.lerp(0.45, 1.12, random() ** 0.28);
    const position = new THREE.Vector3(Math.cos(angle) * ring * radius, z * radius, Math.sin(angle) * ring * radius);
    const color = base.clone().lerp(new THREE.Color('#ffffff'), random() * 0.24);

    writeParticle(
      positions,
      colors,
      sizes,
      alphas,
      phases,
      i,
      position,
      color,
      THREE.MathUtils.lerp(0.008, 0.021, random()),
      THREE.MathUtils.lerp(0.14, 0.48, random()),
      random() * Math.PI * 2
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: makeParticleMaterial(620) };
}

function disposeLayer(layer?: ParticleLayer) {
  if (!layer) return;
  layer.geometry.dispose();
  layer.material.dispose();
}

function ParticlePlanet({ spec, index }: { spec: PlanetSpec; index: number }) {
  const orbitRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Points>(null);
  const ringRef = useRef<THREE.Points>(null);
  const moonOrbitRef = useRef<THREE.Group>(null);
  const burstStartedAtRef = useRef(-100);
  const hitMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);

  const layers = useMemo(() => ({
    body: createPlanetParticles(spec, 9100 + index * 113),
    ring: spec.ring ? createRingParticles(spec, 12000 + index * 157) : undefined,
    moon: spec.moon ? createMoonParticles(spec, 15000 + index * 191) : undefined
  }), [index, spec]);

  useEffect(() => {
    return () => {
      disposeLayer(layers.body);
      disposeLayer(layers.ring);
      disposeLayer(layers.moon);
      hitMaterial.dispose();
    };
  }, [hitMaterial, layers]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const burstAge = performance.now() * 0.001 - burstStartedAtRef.current;
    const burstProgress = burstAge < 1.25
      ? Math.sin(THREE.MathUtils.clamp(burstAge / 1.25, 0, 1) * Math.PI)
      : 0;

    layers.body.material.uniforms.uTime.value = time;
    layers.body.material.uniforms.uBurstProgress.value = burstProgress;
    if (layers.ring) {
      layers.ring.material.uniforms.uTime.value = time;
      layers.ring.material.uniforms.uBurstProgress.value = burstProgress * 0.92;
    }
    if (layers.moon) {
      layers.moon.material.uniforms.uTime.value = time;
      layers.moon.material.uniforms.uBurstProgress.value = burstProgress * 0.78;
    }

    if (orbitRef.current) {
      orbitRef.current.position.set(
        spec.position[0] + Math.sin(time * spec.orbitSpeed + spec.phase) * 0.42,
        spec.position[1] + Math.cos(time * (Math.abs(spec.orbitSpeed) + 0.08) + spec.phase) * spec.floatAmount,
        spec.position[2] + Math.sin(time * 0.12 + spec.phase) * 0.34
      );
      orbitRef.current.rotation.y = time * spec.orbitSpeed * 0.8;
      orbitRef.current.rotation.z = Math.sin(time * 0.18 + spec.phase) * 0.12;
    }

    if (bodyRef.current) {
      bodyRef.current.rotation.y = time * spec.spinSpeed;
      bodyRef.current.rotation.x = Math.sin(time * 0.34 + spec.phase) * 0.16;
      const breathe = 1 + Math.sin(time * 0.88 + spec.phase) * 0.035;
      bodyRef.current.scale.setScalar(breathe);
    }

    if (ringRef.current) {
      ringRef.current.rotation.z = time * spec.spinSpeed * 0.45;
      ringRef.current.rotation.x = Math.PI * 0.58 + Math.sin(time * 0.22 + spec.phase) * 0.12;
    }

    if (moonOrbitRef.current) {
      moonOrbitRef.current.rotation.y = time * (spec.spinSpeed * 1.35 + 0.28);
      moonOrbitRef.current.rotation.z = Math.sin(time * 0.3 + spec.phase) * 0.18;
    }
  });

  return (
    <group ref={orbitRef} position={spec.position} renderOrder={3}>
      <points ref={bodyRef} geometry={layers.body.geometry} material={layers.body.material} renderOrder={3} frustumCulled={false} raycast={() => null} />
      <mesh
        material={hitMaterial}
        onPointerDown={(event) => {
          event.stopPropagation();
          burstStartedAtRef.current = performance.now() * 0.001;
        }}
      >
        <sphereGeometry args={[spec.radius * 2.35, 24, 16]} />
      </mesh>
      {layers.ring && (
        <points
          ref={ringRef}
          geometry={layers.ring.geometry}
          material={layers.ring.material}
          rotation={[Math.PI * 0.58, 0.12, 0.25]}
          renderOrder={3}
          frustumCulled={false}
          raycast={() => null}
        />
      )}
      {layers.moon && (
        <group ref={moonOrbitRef}>
          <points
            geometry={layers.moon.geometry}
            material={layers.moon.material}
            position={[spec.radius * 2.45, 0.04, 0]}
            renderOrder={3}
            frustumCulled={false}
            raycast={() => null}
          />
        </group>
      )}
    </group>
  );
}

export function OrbitalPlanets() {
  return (
    <>
      {PLANETS.map((spec, index) => (
        <ParticlePlanet key={index} spec={spec} index={index} />
      ))}
    </>
  );
}
