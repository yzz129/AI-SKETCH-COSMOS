import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DADAKIDO_WORLD_POSITION } from './cosmicAnchors';
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

export type PlanetSpec = {
  orbitRadiusX: number;
  orbitRadiusY: number;
  orbitDepth: number;
  orbitSpeed: number;
  orbitTilt: number;
  planetRadius: number;      // visual sphere radius
  color: string;
  accent: string;
  ring?: boolean;
  moon?: boolean;
  spinSpeed: number;
  phase: number;
};

type ParticleLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

const REFERENCE_ASPECT = 16 / 10;
const REFERENCE_VIEW_HEIGHT = 22;
const OUTER_ORBIT_FILL = 0.45;
const BASE_OUTER_ORBIT_X = 8.25;
const BASE_OUTER_ORBIT_Y = 3.75;
const PLANET_REVOLUTION_SPEED = 0.27;
const PLANET_SELF_ROTATION_SPEED = 0.68;
const PLANET_RING_VIEW_TILT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(THREE.MathUtils.degToRad(5), 0, 0)
);

let orbitViewportCache = {
  width: 0,
  height: 0,
  scaleX: 1,
  scaleY: 1
};

function getResponsiveOrbitScale() {
  const width = typeof window === 'undefined' ? 1600 : Math.max(window.innerWidth, 1);
  const height = typeof window === 'undefined' ? 1000 : Math.max(window.innerHeight, 1);
  if (orbitViewportCache.width === width && orbitViewportCache.height === height) {
    return orbitViewportCache;
  }

  const aspect = THREE.MathUtils.clamp(width / height, 0.35, 4);
  const referenceWidth = REFERENCE_VIEW_HEIGHT * REFERENCE_ASPECT;
  const viewWidth = aspect >= REFERENCE_ASPECT
    ? REFERENCE_VIEW_HEIGHT * aspect
    : referenceWidth;
  const viewHeight = aspect >= REFERENCE_ASPECT
    ? REFERENCE_VIEW_HEIGHT
    : referenceWidth / aspect;

  orbitViewportCache = {
    width,
    height,
    scaleX: (viewWidth * OUTER_ORBIT_FILL) / BASE_OUTER_ORBIT_X,
    scaleY: (viewHeight * OUTER_ORBIT_FILL) / BASE_OUTER_ORBIT_Y
  };
  return orbitViewportCache;
}

// Three elliptical orbit bands make dadakido read as the visual sun. Four
// planets are phase-spaced on each band, with slower movement farther out.
export const PLANETS: PlanetSpec[] = [
  { orbitRadiusX: 4.9, orbitRadiusY: 1.55, orbitDepth: 0.46, orbitSpeed: 0.11, orbitTilt: 0.035, planetRadius: 0.40, color: '#5ce8ff', accent: '#8b5cff', ring: true, moon: true, spinSpeed: 0.42, phase: 0.15 },
  { orbitRadiusX: 4.9, orbitRadiusY: 1.55, orbitDepth: 0.46, orbitSpeed: 0.11, orbitTilt: 0.035, planetRadius: 0.30, color: '#63f5b5', accent: '#fff08a', moon: true, spinSpeed: 0.62, phase: 1.72 },
  { orbitRadiusX: 4.9, orbitRadiusY: 1.55, orbitDepth: 0.46, orbitSpeed: 0.11, orbitTilt: 0.035, planetRadius: 0.43, color: '#ffa04a', accent: '#fff0cc', ring: true, spinSpeed: 0.30, phase: 3.29 },
  { orbitRadiusX: 4.9, orbitRadiusY: 1.55, orbitDepth: 0.46, orbitSpeed: 0.11, orbitTilt: 0.035, planetRadius: 0.32, color: '#ff6fae', accent: '#84f2ff', ring: true, spinSpeed: 0.48, phase: 4.86 },
  { orbitRadiusX: 6.6, orbitRadiusY: 2.55, orbitDepth: 0.72, orbitSpeed: -0.075, orbitTilt: -0.055, planetRadius: 0.38, color: '#e87bff', accent: '#7ae8ff', moon: true, spinSpeed: 0.55, phase: 0.72 },
  { orbitRadiusX: 6.6, orbitRadiusY: 2.55, orbitDepth: 0.72, orbitSpeed: -0.075, orbitTilt: -0.055, planetRadius: 0.29, color: '#ffe15c', accent: '#ff7e67', moon: true, spinSpeed: 0.68, phase: 2.29 },
  { orbitRadiusX: 6.6, orbitRadiusY: 2.55, orbitDepth: 0.72, orbitSpeed: -0.075, orbitTilt: -0.055, planetRadius: 0.39, color: '#8b5cff', accent: '#fbb8ff', spinSpeed: 0.36, phase: 3.86 },
  { orbitRadiusX: 6.6, orbitRadiusY: 2.55, orbitDepth: 0.72, orbitSpeed: -0.075, orbitTilt: -0.055, planetRadius: 0.34, color: '#58a8ff', accent: '#d6f4ff', ring: true, spinSpeed: 0.4, phase: 5.43 },
  { orbitRadiusX: 8.25, orbitRadiusY: 3.75, orbitDepth: 1.02, orbitSpeed: 0.052, orbitTilt: 0.045, planetRadius: 0.31, color: '#ff7d6e', accent: '#ffd56a', moon: true, spinSpeed: 0.58, phase: 0.38 },
  { orbitRadiusX: 8.25, orbitRadiusY: 3.75, orbitDepth: 1.02, orbitSpeed: 0.052, orbitTilt: 0.045, planetRadius: 0.38, color: '#65d7ff', accent: '#bc7cff', ring: true, spinSpeed: 0.34, phase: 1.95 },
  { orbitRadiusX: 8.25, orbitRadiusY: 3.75, orbitDepth: 1.02, orbitSpeed: 0.052, orbitTilt: 0.045, planetRadius: 0.27, color: '#8df58a', accent: '#fff39a', spinSpeed: 0.72, phase: 3.52 },
  { orbitRadiusX: 8.25, orbitRadiusY: 3.75, orbitDepth: 1.02, orbitSpeed: 0.052, orbitTilt: 0.045, planetRadius: 0.34, color: '#ff8ed8', accent: '#76e8ff', ring: true, moon: true, spinSpeed: 0.46, phase: 5.09 }
];

export function getPlanetLocalPosition(index: number, time: number, target = new THREE.Vector3()) {
  const spec = PLANETS[THREE.MathUtils.euclideanModulo(index, PLANETS.length)];
  const responsiveScale = getResponsiveOrbitScale();
  const angle = spec.phase + time * spec.orbitSpeed * PLANET_REVOLUTION_SPEED;
  const ellipseX = Math.cos(angle) * spec.orbitRadiusX * responsiveScale.scaleX;
  const ellipseY = Math.sin(angle) * spec.orbitRadiusY * responsiveScale.scaleY;
  const cosTilt = Math.cos(spec.orbitTilt);
  const sinTilt = Math.sin(spec.orbitTilt);

  return target.set(
    DADAKIDO_WORLD_POSITION[0] + ellipseX * cosTilt - ellipseY * sinTilt,
    DADAKIDO_WORLD_POSITION[1] + ellipseX * sinTilt + ellipseY * cosTilt,
    DADAKIDO_WORLD_POSITION[2] + Math.sin(angle) * spec.orbitDepth
  );
}

export function getPlanetWorldPosition(index: number, time: number, target = new THREE.Vector3()) {
  return getPlanetLocalPosition(index, time, target);
}

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
/*  ring (screen-stable, shallow Saturn-like ellipse)                  */
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
    // Flat disc in XZ; the parent keeps it almost edge-on to the viewer.
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
  const planetPulse = useAutoCosmicInteractionStore((state) => state.planetPulse);
  const ringParentQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const orbitPosition = useMemo(() => new THREE.Vector3(), []);

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
  const initialPosition = useMemo(() => getPlanetLocalPosition(index, 0), [index]);

  useEffect(() => {
    return () => {
      disposeLayer(layers.body);
      disposeLayer(layers.ring);
      disposeLayer(layers.moon);
      hitMaterial.dispose();
    };
  }, [hitMaterial, layers]);

  useEffect(() => {
    if (planetPulse.id === 0 || planetPulse.id === lastAutoPulseRef.current) return;
    if (planetPulse.planetIndex !== index) return;
    lastAutoPulseRef.current = planetPulse.id;
    burstStartedAtRef.current = performance.now() * 0.001;
  }, [index, planetPulse]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;

    /* ---- revolution around dadakido ---- */
    getPlanetLocalPosition(index, time, orbitPosition);
    orbitRef.current?.position.copy(orbitPosition);
    ringGroupRef.current?.position.copy(orbitPosition);

    /* ---- burst progress (click feedback) ---- */
    const burstAge = performance.now() * 0.001 - burstStartedAtRef.current;
    const burstProgress = burstAge < 1.45
      ? Math.sin(THREE.MathUtils.clamp(burstAge / 1.45, 0, 1) * Math.PI)
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

    /* ---- keep the ring as a thin horizontal ellipse for the viewer ---- */
    if (ringGroupRef.current) {
      ringGroupRef.current.parent?.getWorldQuaternion(ringParentQuaternion);
      ringGroupRef.current.quaternion
        .copy(ringParentQuaternion)
        .invert()
        .multiply(camera.quaternion)
        .multiply(PLANET_RING_VIEW_TILT);
    }

    /* ---- body spin ---- */
    if (bodyRef.current) {
      bodyRef.current.rotation.y = time * spec.spinSpeed * PLANET_SELF_ROTATION_SPEED;
      bodyRef.current.rotation.x = Math.sin(spec.phase) * 0.16;
      bodyRef.current.scale.setScalar(1);
    }

    /* ---- ring self-spin around the fixed plane's local normal ---- */
    if (ringRef.current) {
      ringRef.current.rotation.y = time * spec.spinSpeed * 0.22;
    }

    /* ---- moon orbit ---- */
    if (moonOrbitRef.current) {
      moonOrbitRef.current.rotation.y = time * (spec.spinSpeed * 0.78 + 0.1);
      moonOrbitRef.current.rotation.z = Math.sin(time * 0.3 + spec.phase) * 0.18;
    }
  });

  return (
    <>
      {/* planet body + hit-area + moon — positioned by orbitRef */}
      <group ref={orbitRef} position={initialPosition} renderOrder={14}>
        {/* Render the front shell after creatures so a captured model reads as
            being inside the planet instead of pasted over its surface. */}
        <points ref={bodyRef} geometry={layers.body.geometry} material={layers.body.material} renderOrder={14} frustumCulled={false} raycast={() => null} />
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
        <group
          ref={ringGroupRef}
          position={initialPosition}
          renderOrder={3}
        >
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
