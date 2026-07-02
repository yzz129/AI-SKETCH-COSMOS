import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
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
  rotSpeed: number;
  rotAxis: [number, number, number];
};

type DarkCloudSpec = {
  x: number;
  y: number;
  zRange: [number, number];
  sx: number;
  sy: number;
  count: number;
  color: THREE.Color;
  rotSpeed: number;
};

type ParticleCloud = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

// Base nebula positions — spread to edges, responsive scaling applied at render
const BASE_NEBULAE: NebulaSpec[] = [
  { center: [-6.3, 2.8, -9.5], radiusX: 2.4, radiusY: 1.35, radiusZ: 1.8, count: 7500, opacity: 0.3, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#7b4dff'), sizeRange: [0.004, 0.032], rotSpeed: 0.12, rotAxis: [0.02, 0, 0.98] },
  { center: [6.0, 2.9, -9.0], radiusX: 2.1, radiusY: 1.2, radiusZ: 1.6, count: 6500, opacity: 0.28, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#f7d6ff'), sizeRange: [0.004, 0.029], rotSpeed: -0.14, rotAxis: [-0.03, 0.02, 0.96] },
  { center: [-6.0, -3.0, -9.0], radiusX: 2.0, radiusY: 1.15, radiusZ: 1.6, count: 6200, opacity: 0.28, colorA: new THREE.Color('#3a2a8c'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.004, 0.028], rotSpeed: -0.15, rotAxis: [-0.04, -0.02, 0.94] },
  { center: [6.3, -2.8, -8.5], radiusX: 1.9, radiusY: 1.1, radiusZ: 1.55, count: 5800, opacity: 0.26, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.004, 0.026], rotSpeed: 0.11, rotAxis: [0.03, -0.04, 0.93] },
  { center: [-6.8, 0.2, -10.2], radiusX: 1.4, radiusY: 1.1, radiusZ: 1.2, count: 4200, opacity: 0.24, colorA: new THREE.Color('#d76bff'), colorB: new THREE.Color('#f3a6ff'), sizeRange: [0.003, 0.023], rotSpeed: -0.2, rotAxis: [-0.05, 0.01, 0.9] },
  { center: [6.8, -0.3, -10.0], radiusX: 1.35, radiusY: 1.0, radiusZ: 1.15, count: 3800, opacity: 0.23, colorA: new THREE.Color('#1e7ce6'), colorB: new THREE.Color('#d76bff'), sizeRange: [0.003, 0.021], rotSpeed: 0.18, rotAxis: [0.04, -0.03, 0.9] },
  { center: [-0.4, 3.5, -11.5], radiusX: 1.5, radiusY: 1.25, radiusZ: 1.3, count: 4800, opacity: 0.25, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#d76bff'), sizeRange: [0.003, 0.025], rotSpeed: 0.09, rotAxis: [0.01, -0.02, 0.98] },
  { center: [0.3, -3.5, -11.2], radiusX: 1.55, radiusY: 1.05, radiusZ: 1.35, count: 4600, opacity: 0.25, colorA: new THREE.Color('#3a2a8c'), colorB: new THREE.Color('#f7f3ff'), sizeRange: [0.003, 0.024], rotSpeed: -0.1, rotAxis: [-0.02, 0.03, 0.97] },
];

const DARK_CLOUDS: DarkCloudSpec[] = [
  { x: -6.5, y: -2.9, zRange: [-6.4, -3.6], sx: 2.2, sy: 0.8, count: 480, color: new THREE.Color('#020611'), rotSpeed: -0.04 },
  { x: 6.3, y: -2.9, zRange: [-7.0, -3.8], sx: 2.5, sy: 1.05, count: 560, color: new THREE.Color('#08142e'), rotSpeed: 0.05 },
  { x: -6.7, y: 2.4, zRange: [-8.0, -4.2], sx: 1.0, sy: 2.6, count: 380, color: new THREE.Color('#160b2f'), rotSpeed: -0.06 },
  { x: 6.6, y: 1.8, zRange: [-8.0, -4.2], sx: 1.1, sy: 2.4, count: 380, color: new THREE.Color('#0c0524'), rotSpeed: 0.07 },
  { x: -6.2, y: 2.9, zRange: [-7.5, -4.0], sx: 1.4, sy: 0.9, count: 300, color: new THREE.Color('#0a0418'), rotSpeed: -0.05 },
  { x: 5.8, y: 2.9, zRange: [-7.5, -4.0], sx: 1.3, sy: 0.85, count: 280, color: new THREE.Color('#0c0524'), rotSpeed: 0.06 },
  { x: -6.2, y: -0.3, zRange: [-6.5, -3.4], sx: 2.2, sy: 0.7, count: 360, color: new THREE.Color('#03081a'), rotSpeed: -0.03 },
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
        float orbitSpeed = 0.05 + aDist * 0.09;
        float orbitAngle = uTime * orbitSpeed + aAngle;
        float orbitRadius = aDist * 0.14;
        p.x += cos(orbitAngle) * orbitRadius;
        p.y += sin(orbitAngle) * orbitRadius * 0.65;

        // Floating drift with 3D depth
        p.x += sin(uTime * 0.04 + aPhase + p.y * 0.12 + p.z * 0.1) * 0.06;
        p.y += cos(uTime * 0.038 + aPhase + p.x * 0.1 + p.z * 0.08) * 0.055;
        p.z += sin(uTime * 0.05 + aPhase) * 0.05;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float depthFactor = 1.0 + (p.z - position.z) * 0.04;
        gl_PointSize = aSize * depthFactor * 620.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * (0.78 + 0.22 * sin(uTime * 0.22 + aPhase));
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
        p.xy += vec2(sin(uTime * 0.025 + aPhase), cos(uTime * 0.02 + aPhase)) * 0.04;
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
  const groupRef = useRef<THREE.Group>(null);
  const cloud = useMemo(() => createNebulaPoints(spec), [spec]);
  const sx = spec.center[0] * xScale;
  const sy = spec.center[1] * yScale;

  useFrame(({ clock }) => {
    cloud.material.uniforms.uTime.value = clock.elapsedTime;
    if (groupRef.current) {
      const t = clock.elapsedTime;
      const [ax, ay, az] = spec.rotAxis;
      groupRef.current.rotation.set(ax * t * spec.rotSpeed, ay * t * spec.rotSpeed, az * t * spec.rotSpeed);
    }
  });

  return (
    <group ref={groupRef} position={[sx, sy, spec.center[2]]}>
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
  const groupRef = useRef<THREE.Group>(null);
  const cloud = useMemo(() => createDarkCloudPoints(spec), [spec]);

  useFrame(({ clock }) => {
    cloud.material.uniforms.uTime.value = clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.z = clock.elapsedTime * spec.rotSpeed;
    }
  });

  const sx = spec.x * xScale;
  const sy = spec.y * yScale;
  const midZ = (spec.zRange[0] + spec.zRange[1]) * 0.5;

  return (
    <group ref={groupRef} position={[sx, sy, midZ]}>
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
