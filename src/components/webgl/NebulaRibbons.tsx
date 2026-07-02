import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

type NebulaClusterSpec = {
  center: [number, number, number];
  radius: number;
  stretchX: number;
  stretchY: number;
  count: number;
  opacity: number;
  palette: THREE.Color[];
  sizeRange: [number, number];
  softness: number;
  rotSpeed: number;
  rotAxis: [number, number, number];
};

type ClusterLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

const PALETTES: THREE.Color[][] = [
  [new THREE.Color('#64d9ff'), new THREE.Color('#1e7ce6'), new THREE.Color('#7b4dff'), new THREE.Color('#f7f3ff')],
  [new THREE.Color('#d76bff'), new THREE.Color('#7b4dff'), new THREE.Color('#f3a6ff'), new THREE.Color('#f7f3ff')],
  [new THREE.Color('#64d9ff'), new THREE.Color('#3a2a8c'), new THREE.Color('#7b4dff'), new THREE.Color('#d76bff')],
  [new THREE.Color('#f2913c'), new THREE.Color('#d76bff'), new THREE.Color('#7b4dff'), new THREE.Color('#ffe8b8')],
  [new THREE.Color('#1e7ce6'), new THREE.Color('#64d9ff'), new THREE.Color('#f7f3ff'), new THREE.Color('#7b4dff')],
  [new THREE.Color('#7b4dff'), new THREE.Color('#64d9ff'), new THREE.Color('#f3a6ff'), new THREE.Color('#d76bff')],
  [new THREE.Color('#3a2a8c'), new THREE.Color('#7b4dff'), new THREE.Color('#d76bff'), new THREE.Color('#64d9ff')],
  [new THREE.Color('#d76bff'), new THREE.Color('#f3a6ff'), new THREE.Color('#7b4dff'), new THREE.Color('#f7f3ff')],
];

// Base positions (before responsive scaling) — pushed to edges with large gaps
const BASE_CLUSTERS: NebulaClusterSpec[] = [
  // Corner clusters — large & prominent
  { center: [-6.5, 3.2, -10.5], radius: 2.0, stretchX: 1.0, stretchY: 0.65, count: 9000, opacity: 0.36, palette: PALETTES[0], sizeRange: [0.003, 0.022], softness: 0.26, rotSpeed: 0.14, rotAxis: [0.01, 0, 0.99] },
  { center: [6.3, 3.2, -10.0], radius: 1.9, stretchX: 1.1, stretchY: 0.7, count: 8000, opacity: 0.32, palette: PALETTES[1], sizeRange: [0.003, 0.02], softness: 0.3, rotSpeed: -0.16, rotAxis: [-0.03, 0.02, 0.97] },
  { center: [-6.2, -3.1, -10.5], radius: 1.75, stretchX: 1.05, stretchY: 0.62, count: 7200, opacity: 0.33, palette: PALETTES[3], sizeRange: [0.003, 0.02], softness: 0.28, rotSpeed: -0.12, rotAxis: [-0.02, -0.04, 0.95] },
  { center: [6.5, -3.0, -9.5], radius: 1.85, stretchX: 1.05, stretchY: 0.68, count: 8000, opacity: 0.32, palette: PALETTES[2], sizeRange: [0.003, 0.02], softness: 0.3, rotSpeed: 0.13, rotAxis: [0.04, -0.01, 0.94] },
  // Edge-middle clusters
  { center: [-6.8, 0.4, -11.0], radius: 1.4, stretchX: 0.85, stretchY: 0.72, count: 5500, opacity: 0.27, palette: PALETTES[5], sizeRange: [0.003, 0.017], softness: 0.34, rotSpeed: -0.18, rotAxis: [-0.05, 0.02, 0.9] },
  { center: [6.7, -0.4, -10.8], radius: 1.3, stretchX: 0.9, stretchY: 0.7, count: 5000, opacity: 0.26, palette: PALETTES[4], sizeRange: [0.003, 0.016], softness: 0.36, rotSpeed: 0.19, rotAxis: [0.03, -0.05, 0.88] },
  { center: [-0.2, 3.6, -12.0], radius: 1.25, stretchX: 0.85, stretchY: 0.78, count: 5000, opacity: 0.25, palette: PALETTES[6], sizeRange: [0.003, 0.016], softness: 0.36, rotSpeed: 0.1, rotAxis: [0, -0.03, 0.98] },
  { center: [0.3, -3.5, -11.5], radius: 1.35, stretchX: 0.95, stretchY: 0.62, count: 5300, opacity: 0.27, palette: PALETTES[7], sizeRange: [0.003, 0.017], softness: 0.34, rotSpeed: -0.11, rotAxis: [0.02, 0.04, 0.93] },
  // Small accent corner clusters
  { center: [-6.8, 2.9, -12.5], radius: 0.65, stretchX: 0.7, stretchY: 0.85, count: 2000, opacity: 0.22, palette: PALETTES[5], sizeRange: [0.002, 0.013], softness: 0.48, rotSpeed: -0.25, rotAxis: [0.06, 0.02, 0.84] },
  { center: [6.9, 2.7, -12.5], radius: 0.7, stretchX: 0.75, stretchY: 0.8, count: 2200, opacity: 0.22, palette: PALETTES[0], sizeRange: [0.002, 0.014], softness: 0.46, rotSpeed: 0.24, rotAxis: [-0.05, 0.04, 0.86] },
  { center: [-6.9, -2.7, -12.0], radius: 0.6, stretchX: 0.75, stretchY: 0.72, count: 1900, opacity: 0.2, palette: PALETTES[1], sizeRange: [0.002, 0.012], softness: 0.5, rotSpeed: -0.22, rotAxis: [-0.04, -0.05, 0.85] },
  { center: [6.9, -2.5, -12.0], radius: 0.65, stretchX: 0.8, stretchY: 0.72, count: 2000, opacity: 0.22, palette: PALETTES[2], sizeRange: [0.002, 0.013], softness: 0.48, rotSpeed: 0.2, rotAxis: [0.05, -0.03, 0.87] },
];

function makeMaterial(softness: number) {
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
      uSoftness: { value: softness },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSoftness;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      attribute float aCenterX;
      attribute float aCenterY;
      attribute float aAngle;
      attribute float aDist;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec3 p = position;
        float cx = aCenterX;
        float cy = aCenterY;

        // Orbital swirl: particles slowly orbit the cluster center for fluid vortex feel
        float orbitSpeed = 0.06 + aDist * 0.08;
        float orbitAngle = uTime * orbitSpeed + aAngle;
        float orbitRadius = aDist * 0.12;
        p.x = cx + (p.x - cx) + cos(orbitAngle) * orbitRadius;
        p.y = cy + (p.y - cy) + sin(orbitAngle) * orbitRadius * 0.7;

        // Breathing: gentle in-out pulse
        float breathe = 1.0 + sin(uTime * 0.18 + aPhase) * 0.03;
        p.x = cx + (p.x - cx) * breathe;
        p.y = cy + (p.y - cy) * breathe;
        p.z += sin(uTime * 0.14 + aPhase + p.z * 0.3) * 0.06;

        // Slow 3D drift
        p.x += sin(uTime * 0.05 + aPhase + p.y * 0.25 + p.z * 0.15) * 0.05;
        p.y += cos(uTime * 0.045 + aPhase + p.x * 0.22 + p.z * 0.12) * 0.045;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float pulse = 0.82 + 0.18 * sin(uTime * 0.2 + aPhase);
        // Depth-based size: closer particles larger for 3D parallax
        float depthFactor = 1.0 + (p.z - position.z) * 0.04;
        gl_PointSize = aSize * depthFactor * pulse * 640.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * pulse;
        vDepth = -mvPosition.z;
      }
    `,
    fragmentShader: `
      uniform float uSoftness;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        // Multi-layer glow for volumetric 3D feel
        float core = smoothstep(0.18, 0.0, d);
        float midHalo = smoothstep(0.4, 0.02, d) * 0.5;
        float outerGlow = smoothstep(0.58, 0.05, d) * 0.28;
        float alpha = mix(core + midHalo * 0.45, midHalo + outerGlow, uSoftness) * vAlpha;
        // Depth fog: distant particles slightly dimmer
        alpha *= 1.0 - smoothstep(8.0, 20.0, vDepth) * 0.25;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
}

function createNebulaCluster(spec: NebulaClusterSpec): ClusterLayer {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(spec.count * 3);
  const colors = new Float32Array(spec.count * 3);
  const sizes = new Float32Array(spec.count);
  const alphas = new Float32Array(spec.count);
  const phases = new Float32Array(spec.count);
  const centerXArr = new Float32Array(spec.count);
  const centerYArr = new Float32Array(spec.count);
  const angles = new Float32Array(spec.count);
  const dists = new Float32Array(spec.count);

  const [cx, cy, cz] = spec.center;

  for (let i = 0; i < spec.count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const rawRadius = Math.pow(Math.random(), 0.52) * spec.radius;
    const i3 = i * 3;
    const rx = rawRadius * spec.stretchX;
    const ry = rawRadius * spec.stretchY;
    const edge = THREE.MathUtils.clamp(rawRadius / Math.max(spec.radius, 0.001), 0, 1);

    // Wider z-spread for 3D depth
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    const pz = cz + THREE.MathUtils.randFloatSpread(spec.radius * 0.65);

    const paletteIndex = Math.floor(Math.random() * (spec.palette.length - 1));
    const color = spec.palette[paletteIndex].clone().lerp(
      spec.palette[Math.min(paletteIndex + 1, spec.palette.length - 1)],
      Math.random(),
    );
    if (edge < 0.22 && Math.random() > 0.72) {
      color.lerp(spec.palette[spec.palette.length - 1], 0.4);
    }

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
    sizes[i] = THREE.MathUtils.randFloat(spec.sizeRange[0], spec.sizeRange[1]) * (1.15 - edge * 0.35);
    alphas[i] = spec.opacity * THREE.MathUtils.randFloat(0.2, 1.0) * (1.0 - edge * 0.65);
    phases[i] = Math.random() * Math.PI * 2;
    centerXArr[i] = cx;
    centerYArr[i] = cy;
    angles[i] = angle;
    dists[i] = rawRadius;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aCenterX', new THREE.BufferAttribute(centerXArr, 1));
  geometry.setAttribute('aCenterY', new THREE.BufferAttribute(centerYArr, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aDist', new THREE.BufferAttribute(dists, 1));
  geometry.computeBoundingSphere();

  return { geometry, material: makeMaterial(spec.softness) };
}

function NebulaClusterPoints({ spec, xScale, yScale }: { spec: NebulaClusterSpec; xScale: number; yScale: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const layer = useMemo(() => createNebulaCluster(spec), [spec]);

  const scaledCenter: [number, number, number] = useMemo(
    () => [spec.center[0] * xScale, spec.center[1] * yScale, spec.center[2]],
    [spec.center, xScale, yScale],
  );

  useFrame(({ clock }) => {
    layer.material.uniforms.uTime.value = clock.elapsedTime;
    if (groupRef.current) {
      const t = clock.elapsedTime;
      const [ax, ay, az] = spec.rotAxis;
      groupRef.current.rotation.set(ax * t * spec.rotSpeed, ay * t * spec.rotSpeed, az * t * spec.rotSpeed);
    }
  });

  return (
    <group ref={groupRef} position={scaledCenter}>
      <points
        geometry={layer.geometry}
        material={layer.material}
        position={[-spec.center[0], -spec.center[1], -spec.center[2]]}
        renderOrder={4}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

export function NebulaRibbons() {
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);
  const xScale = Math.max(0.75, Math.min(1.4, aspect / 1.78));
  const yScale = Math.max(0.8, Math.min(1.3, 1.78 / aspect));
  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => requestAnimationFrame(() => setVisibleCount(6)), 240),
      window.setTimeout(() => requestAnimationFrame(() => setVisibleCount(9)), 500),
      window.setTimeout(() => requestAnimationFrame(() => setVisibleCount(BASE_CLUSTERS.length)), 800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <>
      {BASE_CLUSTERS.slice(0, visibleCount).map((spec, i) => (
        <NebulaClusterPoints key={i} spec={spec} xScale={xScale} yScale={yScale} />
      ))}
    </>
  );
}
