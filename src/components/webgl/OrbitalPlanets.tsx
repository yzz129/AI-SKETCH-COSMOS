import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CREATURE_ORBIT_CENTER } from './cosmicAnchors';
import { hasCreaturePriorityHit } from './pointerPriority';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';

/* ------------------------------------------------------------------ */
/*  responsive density — debounced to avoid recreating geometries      */
/*  on every pixel of resize                                           */
/* ------------------------------------------------------------------ */

function useDensityMul() {
  const compute = useCallback(() => {
    const raw = window.innerWidth / 1440;
    return Math.min(2.2, Math.max(0.65, raw));
  }, []);

  const [mul, setMul] = useState(compute);

  useEffect(() => {
    let last = mul;
    const onResize = () => {
      const next = compute();
      // Only update when change exceeds 12 % — avoids thrash
      if (Math.abs(next - last) > 0.12) {
        last = next;
        setMul(next);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [compute, mul]);

  return mul;
}

const DADAKIDO = CREATURE_ORBIT_CENTER;

type PlanetSpec = {
  orbitRadius: number;       // distance from dadakido centre
  orbitSpeed: number;        // angular speed (Kepler: faster when closer)
  inclination: number;       // orbital inclination radians
  phaseOffset: number;       // starting angle
  planetRadius: number;      // visual sphere radius
  color: string;
  accent: string;
  ring?: boolean;
  moon?: boolean;
  spinSpeed: number;
  floatAmount: number;
  phase: number;
};

type ParticleLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

/*
   Kepler-friendly orbital speeds: ω ∝ r^(−3/2).
   Wide orbits spread across the full screen, slow majestic pace.
*/
const PLANETS: PlanetSpec[] = [
  { orbitRadius: 3.5, orbitSpeed: 0.35, inclination: 0.18, phaseOffset: 0.4, planetRadius: 0.60, color: '#5ce8ff', accent: '#8b5cff', ring: true, moon: true, spinSpeed: 0.42, floatAmount: 0.18, phase: 0.4 },
  { orbitRadius: 6.2, orbitSpeed: 0.15, inclination: -0.24, phaseOffset: 1.7, planetRadius: 0.75, color: '#ffa04a', accent: '#fff0cc', ring: true, spinSpeed: 0.30, floatAmount: 0.14, phase: 1.7 },
  { orbitRadius: 8.8, orbitSpeed: 0.09, inclination: 0.32, phaseOffset: 3.1, planetRadius: 0.46, color: '#e87bff', accent: '#7ae8ff', moon: true, spinSpeed: 0.55, floatAmount: 0.11, phase: 3.1 },
  { orbitRadius: 11.5, orbitSpeed: 0.06, inclination: -0.16, phaseOffset: 4.4, planetRadius: 0.52, color: '#8b5cff', accent: '#fbb8ff', spinSpeed: 0.36, floatAmount: 0.09, phase: 4.4 }
];

/* ------------------------------------------------------------------ */
/*  seeded PRNG                                                        */
/* ------------------------------------------------------------------ */

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/*  shared point-cloud material (additive, soft core + halo)           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  particle helpers                                                    */
/* ------------------------------------------------------------------ */

function writeParticle(
  positions: Float32Array, colors: Float32Array, sizes: Float32Array,
  alphas: Float32Array, phases: Float32Array, index: number,
  position: THREE.Vector3, color: THREE.Color,
  size: number, alpha: number, phase: number
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

/* ------------------------------------------------------------------ */
/*  planet body (spherical point-cloud)                                 */
/* ------------------------------------------------------------------ */

function createPlanetParticles(spec: PlanetSpec, seed: number, densityMul: number): ParticleLayer {
  const d = Math.round(densityMul * densityMul); // area scaling
  const random = seededRandom(seed);
  const shellCount = Math.round((1300 + spec.planetRadius * 2600) * d);
  const glowCount = Math.round((280 + spec.planetRadius * 700) * d);
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
    const radius = spec.planetRadius * THREE.MathUtils.lerp(0.42, 1.02, shellBias);
    const latitudeShade = 0.5 + 0.5 * Math.sin(phi * 5.0 + spec.phase);
    const color = base.clone().lerp(accent, latitudeShade * 0.38 + random() * 0.16);
    if (random() > 0.82) color.lerp(highlight, random() * 0.22);

    const position = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius,
      Math.sin(phi) * Math.sin(theta) * radius
    );
    writeParticle(positions, colors, sizes, alphas, phases, i, position, color,
      THREE.MathUtils.lerp(0.015, 0.038, random() ** 0.65),
      THREE.MathUtils.lerp(0.30, 0.72, random() ** 0.8),
      random() * Math.PI * 2);
  }

  for (let i = 0; i < glowCount; i += 1) {
    const index = shellCount + i;
    const angle = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = spec.planetRadius * THREE.MathUtils.lerp(1.02, 1.42, random() ** 0.65);
    const position = new THREE.Vector3(Math.cos(angle) * ring * radius, z * radius, Math.sin(angle) * ring * radius);
    const color = accent.clone().lerp(highlight, random() * 0.12);
    writeParticle(positions, colors, sizes, alphas, phases, index, position, color,
      THREE.MathUtils.lerp(0.02, 0.055, random() ** 1.3),
      THREE.MathUtils.lerp(0.08, 0.24, random()),
      random() * Math.PI * 2);
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

/* ------------------------------------------------------------------ */
/*  ring (flat elliptical disc — billboarded at runtime)               */
/* ------------------------------------------------------------------ */

function createRingParticles(spec: PlanetSpec, seed: number, densityMul: number): ParticleLayer {
  const d = Math.round(densityMul * densityMul);
  const random = seededRandom(seed);
  const count = Math.round((1100 + spec.planetRadius * 1800) * d);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const base = new THREE.Color(spec.accent);
  const highlight = new THREE.Color('#f7f3ff');

  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = spec.planetRadius * THREE.MathUtils.lerp(1.28, 2.65, random());
    const band = THREE.MathUtils.randFloatSpread(spec.planetRadius * 0.08);
    // flat disc in XZ plane (billboard will orient it toward camera)
    const position = new THREE.Vector3(Math.cos(angle) * radius, band, Math.sin(angle) * radius);
    const color = base.clone().lerp(highlight, random() * 0.26);

    writeParticle(positions, colors, sizes, alphas, phases, i, position, color,
      THREE.MathUtils.lerp(0.012, 0.038, random() ** 0.75),
      THREE.MathUtils.lerp(0.22, 0.62, random()),  // bolder, more visible ring
      random() * Math.PI * 2);
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

/* ------------------------------------------------------------------ */
/*  moon (tiny satellite orbiting the planet)                           */
/* ------------------------------------------------------------------ */

function createMoonParticles(spec: PlanetSpec, seed: number, densityMul: number): ParticleLayer {
  const d = Math.round(densityMul * densityMul);
  const random = seededRandom(seed);
  const count = Math.round(240 * d);
  const moonRadius = spec.planetRadius * 0.18;
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

    writeParticle(positions, colors, sizes, alphas, phases, i, position, color,
      THREE.MathUtils.lerp(0.008, 0.021, random()),
      THREE.MathUtils.lerp(0.14, 0.48, random()),
      random() * Math.PI * 2);
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

/* ------------------------------------------------------------------ */
/*  cleanup                                                             */
/* ------------------------------------------------------------------ */

function disposeLayer(layer?: ParticleLayer) {
  if (!layer) return;
  layer.geometry.dispose();
  layer.material.dispose();
}

/* ------------------------------------------------------------------ */
/*  single planet                                                       */
/* ------------------------------------------------------------------ */

function ParticlePlanet({ spec, index }: { spec: PlanetSpec; index: number }) {
  const orbitRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Points>(null);
  const ringRef = useRef<THREE.Points>(null);
  const ringGroupRef = useRef<THREE.Group>(null);
  const moonOrbitRef = useRef<THREE.Group>(null);
  const burstStartedAtRef = useRef(-100);
  const lastAutoPulseRef = useRef(0);
  const { camera } = useThree();
  const densityMul = useDensityMul();
  const planetPulseId = useAutoCosmicInteractionStore((state) => state.planetPulseId);

  const hitMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);

  const layers = useMemo(() => ({
    body: createPlanetParticles(spec, 9100 + index * 113, densityMul),
    ring: spec.ring ? createRingParticles(spec, 12000 + index * 157, densityMul) : undefined,
    moon: spec.moon ? createMoonParticles(spec, 15000 + index * 191, densityMul) : undefined
  }), [index, spec, densityMul]);

  useEffect(() => {
    return () => {
      disposeLayer(layers.body);
      disposeLayer(layers.ring);
      disposeLayer(layers.moon);
      hitMaterial.dispose();
    };
  }, [hitMaterial, layers]);

  useEffect(() => {
    if (planetPulseId === 0 || planetPulseId === lastAutoPulseRef.current) return;
    if ((planetPulseId + index) % PLANETS.length !== 0) return;
    lastAutoPulseRef.current = planetPulseId;
    burstStartedAtRef.current = performance.now() * 0.001;
  }, [index, planetPulseId]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;

    /* ---- burst progress (click feedback) ---- */
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

    /* ---- Kepler orbit around dadakido ---- */
    const angle = time * spec.orbitSpeed + spec.phaseOffset;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // inclination tilts the orbit plane
    const cosInc = Math.cos(spec.inclination);
    const sinInc = Math.sin(spec.inclination);

    const orbitX = cosInc * cosA * spec.orbitRadius;
    const orbitY = sinInc * cosA * spec.orbitRadius
      + Math.cos(time * 0.62 + spec.phase) * spec.floatAmount;
    const orbitZ = cosInc * sinA * spec.orbitRadius;

    if (orbitRef.current) {
      orbitRef.current.position.set(
        DADAKIDO.x + orbitX,
        DADAKIDO.y + orbitY,
        DADAKIDO.z + orbitZ
      );
    }

    /* ---- ring: billboard toward camera so it always looks centred ---- */
    if (ringGroupRef.current && orbitRef.current) {
      const worldPos = new THREE.Vector3();
      orbitRef.current.getWorldPosition(worldPos);
      ringGroupRef.current.position.copy(worldPos);
      ringGroupRef.current.quaternion.copy(camera.quaternion);
    }

    /* ---- body spin ---- */
    if (bodyRef.current) {
      bodyRef.current.rotation.y = time * spec.spinSpeed;
      bodyRef.current.rotation.x = Math.sin(time * 0.34 + spec.phase) * 0.16;
      const breathe = 1 + Math.sin(time * 0.88 + spec.phase) * 0.035;
      bodyRef.current.scale.setScalar(breathe);
    }

    /* ---- ring self-spin (visual only, on top of billboard) ---- */
    if (ringRef.current) {
      ringRef.current.rotation.z = time * spec.spinSpeed * 0.45;
    }

    /* ---- moon orbit ---- */
    if (moonOrbitRef.current) {
      moonOrbitRef.current.rotation.y = time * (spec.spinSpeed * 1.35 + 0.28);
      moonOrbitRef.current.rotation.z = Math.sin(time * 0.3 + spec.phase) * 0.18;
    }
  });

  return (
    <>
      {/* planet body + hit-area + moon — positioned by orbitRef */}
      <group ref={orbitRef} renderOrder={3}>
        <points ref={bodyRef} geometry={layers.body.geometry} material={layers.body.material} renderOrder={3} frustumCulled={false} raycast={() => null} />
        <mesh
          material={hitMaterial}
          onPointerDown={(event) => {
            if (hasCreaturePriorityHit(event)) return;
            event.stopPropagation();
            burstStartedAtRef.current = performance.now() * 0.001;
          }}
        >
          <sphereGeometry args={[spec.planetRadius * 2.35, 24, 16]} />
        </mesh>
        {layers.moon && (
          <group ref={moonOrbitRef}>
            <points
              geometry={layers.moon.geometry}
              material={layers.moon.material}
              position={[spec.planetRadius * 2.45, 0.04, 0]}
              renderOrder={3}
              frustumCulled={false}
              raycast={() => null}
            />
          </group>
        )}
      </group>

      {/* ring — separate group, billboarded */}
      {layers.ring && (
        <group ref={ringGroupRef} renderOrder={3}>
          <points
            ref={ringRef}
            geometry={layers.ring.geometry}
            material={layers.ring.material}
            renderOrder={3}
            frustumCulled={false}
            raycast={() => null}
          />
        </group>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  public API                                                          */
/* ------------------------------------------------------------------ */

export function OrbitalPlanets() {
  return (
    <>
      {PLANETS.map((spec, index) => (
        <ParticlePlanet key={index} spec={spec} index={index} />
      ))}
    </>
  );
}
