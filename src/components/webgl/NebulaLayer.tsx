import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

type NebulaSpec = {
  center: [number, number, number];
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  count: number;
  opacity: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  sizeRange: [number, number];
};

type DarkCloudSpec = {
  x: number;
  y: number;
  zRange: [number, number];
  sx: number;
  sy: number;
  count: number;
  color: THREE.Color;
};

type ParticleCloud = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

// Base nebula positions — spread to edges, responsive scaling applied at render
const BASE_NEBULAE: NebulaSpec[] = [
  { center: [-4.7, 2.7, -9.5], radiusX: 1.8, radiusY: 1.05, radiusZ: 1.5, count: 5600, opacity: 0.27, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#7b4dff'), sizeRange: [0.004, 0.03] },
  { center: [5.0, 2.5, -9.0], radiusX: 1.65, radiusY: 1.0, radiusZ: 1.4, count: 5100, opacity: 0.26, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#f7d6ff'), sizeRange: [0.004, 0.028] },
  { center: [-4.8, -2.6, -9.0], radiusX: 1.7, radiusY: 1.0, radiusZ: 1.4, count: 5000, opacity: 0.26, colorA: new THREE.Color('#3a2a8c'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.004, 0.027] },
  { center: [4.5, -2.7, -8.5], radiusX: 1.6, radiusY: 0.95, radiusZ: 1.35, count: 4800, opacity: 0.24, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.004, 0.025] },
  { center: [-7.4, 1.15, -10.2], radiusX: 1.15, radiusY: 0.9, radiusZ: 1.05, count: 3200, opacity: 0.22, colorA: new THREE.Color('#d76bff'), colorB: new THREE.Color('#f3a6ff'), sizeRange: [0.003, 0.022] },
  { center: [7.4, -1.1, -10.0], radiusX: 1.1, radiusY: 0.85, radiusZ: 1.0, count: 3000, opacity: 0.21, colorA: new THREE.Color('#1e7ce6'), colorB: new THREE.Color('#d76bff'), sizeRange: [0.003, 0.02] },
  { center: [0, 4.25, -11.5], radiusX: 1.25, radiusY: 0.9, radiusZ: 1.1, count: 3400, opacity: 0.23, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#d76bff'), sizeRange: [0.003, 0.024] },
  { center: [0, -4.15, -11.2], radiusX: 1.3, radiusY: 0.85, radiusZ: 1.15, count: 3300, opacity: 0.23, colorA: new THREE.Color('#3a2a8c'), colorB: new THREE.Color('#f7f3ff'), sizeRange: [0.003, 0.023] },
];

const DARK_CLOUDS: DarkCloudSpec[] = [
  { x: -4.8, y: -2.7, zRange: [-6.4, -3.6], sx: 1.7, sy: 0.7, count: 390, color: new THREE.Color('#020611') },
  { x: 4.6, y: -2.8, zRange: [-7.0, -3.8], sx: 1.8, sy: 0.8, count: 420, color: new THREE.Color('#08142e') },
  { x: -7.3, y: 1.2, zRange: [-8.0, -4.2], sx: 0.9, sy: 1.8, count: 300, color: new THREE.Color('#160b2f') },
  { x: 7.3, y: -1.1, zRange: [-8.0, -4.2], sx: 0.9, sy: 1.8, count: 300, color: new THREE.Color('#0c0524') },
  { x: -4.5, y: 2.7, zRange: [-7.5, -4.0], sx: 1.1, sy: 0.7, count: 250, color: new THREE.Color('#0a0418') },
  { x: 5.0, y: 2.5, zRange: [-7.5, -4.0], sx: 1.1, sy: 0.7, count: 240, color: new THREE.Color('#0c0524') },
  { x: 0, y: -4.0, zRange: [-6.5, -3.4], sx: 1.6, sy: 0.6, count: 280, color: new THREE.Color('#03081a') },
];

function createNebulaPoints(spec: NebulaSpec): ParticleCloud {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(spec.count * 3);
  const colors = new Float32Array(spec.count * 3);
  const sizes = new Float32Array(spec.count);
  const alphas = new Float32Array(spec.count);
  const phases = new Float32Array(spec.count);
  const angles = new Float32Array(spec.count);
  const dists = new Float32Array(spec.count);

  for (let i = 0; i < spec.count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() < 0.35
      ? Math.pow(Math.random(), 2.2)
      : 0.12 + Math.pow(Math.random(), 0.42) * 0.88;
    const i3 = i * 3;

    const px = Math.cos(angle) * r * spec.radiusX;
    const py = Math.sin(angle) * r * spec.radiusY;
    const pz = THREE.MathUtils.randFloatSpread(spec.radiusZ);

    const edgeBlend = THREE.MathUtils.clamp(r, 0, 1);
    const color = spec.colorA.clone().lerp(spec.colorB, edgeBlend * 0.55 + Math.random() * 0.22);
    const coreBoost = Math.exp(-r * 3.0);

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
    sizes[i] = THREE.MathUtils.randFloat(spec.sizeRange[0], spec.sizeRange[1]) * (0.66 + coreBoost * 0.8 + r * 0.12);
    alphas[i] = spec.opacity * THREE.MathUtils.randFloat(0.24, 1.0) * (0.28 + coreBoost * 0.72 - r * 0.16);
    phases[i] = Math.random() * Math.PI * 2;
    angles[i] = angle;
    dists[i] = r;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aDist', new THREE.BufferAttribute(dists, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aAngle;
      attribute float aDist;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec3 p = position;
        // Orbital swirl for fluid vortex motion
        float orbitSpeed = 0.1 + aDist * 0.18;
        float orbitAngle = uTime * orbitSpeed + aAngle;
        float orbitRadius = aDist * 0.26;
        p.x += cos(orbitAngle) * orbitRadius;
        p.y += sin(orbitAngle) * orbitRadius * 0.9;

        // Floating drift with 3D depth
        p.x += sin(uTime * 0.095 + aPhase + p.y * 0.16 + p.z * 0.13) * 0.13;
        p.y += cos(uTime * 0.082 + aPhase + p.x * 0.14 + p.z * 0.12) * 0.115;
        p.z += sin(uTime * 0.11 + aPhase) * 0.13;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float depthFactor = 1.0 + (p.z - position.z) * 0.04;
        gl_PointSize = aSize * depthFactor * 620.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * (0.68 + 0.32 * sin(uTime * 0.46 + aPhase));
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
        float core = smoothstep(0.2, 0.0, d);
        float midHalo = smoothstep(0.42, 0.02, d) * 0.45;
        float outerGlow = smoothstep(0.6, 0.05, d) * 0.22;
        float alpha = (core + midHalo * 0.5 + outerGlow) * vAlpha;
        alpha *= 1.0 - smoothstep(8.0, 22.0, vDepth) * 0.22;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  return { geometry, material };
}

function createDarkCloudPoints(spec: DarkCloudSpec): ParticleCloud {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(spec.count * 3);
  const colors = new Float32Array(spec.count * 3);
  const sizes = new Float32Array(spec.count);
  const alphas = new Float32Array(spec.count);
  const phases = new Float32Array(spec.count);

  const accent = new THREE.Color('#1d1a5c');

  for (let i = 0; i < spec.count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.pow(Math.random(), 0.4);
    const i3 = i * 3;
    const color = spec.color.clone().lerp(accent, Math.random() * 0.22);

    positions[i3] = Math.cos(angle) * radius * spec.sx + THREE.MathUtils.randFloatSpread(0.25);
    positions[i3 + 1] = Math.sin(angle) * radius * spec.sy + THREE.MathUtils.randFloatSpread(0.2);
    positions[i3 + 2] = THREE.MathUtils.randFloat(spec.zRange[0], spec.zRange[1]);
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
    sizes[i] = THREE.MathUtils.randFloat(0.04, 0.16);
    alphas[i] = THREE.MathUtils.randFloat(0.03, 0.11) * (1 - radius * 0.34);
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.xy += vec2(sin(uTime * 0.06 + aPhase), cos(uTime * 0.052 + aPhase)) * 0.11;
        p.z += sin(uTime * 0.04 + aPhase) * 0.08;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * 600.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(p)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  return { geometry, material };
}

function NebulaCloud({ spec, xScale, yScale }: { spec: NebulaSpec; xScale: number; yScale: number }) {
  const cloud = useMemo(() => createNebulaPoints(spec), [spec]);
  const sx = spec.center[0] * xScale;
  const sy = spec.center[1] * yScale;

  return (
    <group position={[sx, sy, spec.center[2]]}>
      <points
        geometry={cloud.geometry}
        material={cloud.material}
        position={[-spec.center[0], -spec.center[1], -spec.center[2]]}
        renderOrder={4}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

function DarkCloud({ spec, xScale, yScale }: { spec: DarkCloudSpec; xScale: number; yScale: number }) {
  const cloud = useMemo(() => createDarkCloudPoints(spec), [spec]);

  const sx = spec.x * xScale;
  const sy = spec.y * yScale;
  const midZ = (spec.zRange[0] + spec.zRange[1]) * 0.5;

  return (
    <group position={[sx, sy, midZ]}>
      <points
        geometry={cloud.geometry}
        material={cloud.material}
        position={[-spec.x, -spec.y, -midZ]}
        renderOrder={4}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

export function NebulaLayer() {
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);
  const xScale = Math.max(0.75, Math.min(1.4, aspect / 1.78));
  const yScale = Math.max(0.8, Math.min(1.3, 1.78 / aspect));

  return (
    <>
      {DARK_CLOUDS.map((spec, i) => (
        <DarkCloud key={`dark-${i}`} spec={spec} xScale={xScale} yScale={yScale} />
      ))}
      {BASE_NEBULAE.map((spec, i) => (
        <NebulaCloud key={`nebula-${i}`} spec={spec} xScale={xScale} yScale={yScale} />
      ))}
    </>
  );
}
