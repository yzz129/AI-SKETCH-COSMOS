import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type NebulaCluster = {
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

// Scattered independent nebula clusters — each has unique rotation speed & axis
const CLUSTERS: NebulaCluster[] = [
  { center: [-5.2, 1.85, -9.2], radiusX: 2.2, radiusY: 1.25, radiusZ: 1.4, count: 5000, opacity: 0.44, colorA: new THREE.Color('#4b3acf'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.01, 0.06], rotSpeed: 0.12, rotAxis: [0.01, 0, 0.99] },
  { center: [3.8, -2.0, -8.4], radiusX: 1.9, radiusY: 1.15, radiusZ: 1.25, count: 4200, opacity: 0.38, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#f7d6ff'), sizeRange: [0.008, 0.052], rotSpeed: -0.15, rotAxis: [-0.02, 0.03, 0.96] },
  { center: [0.6, 2.35, -10.5], radiusX: 1.55, radiusY: 1.4, radiusZ: 1.1, count: 3200, opacity: 0.34, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#7b4dff'), sizeRange: [0.008, 0.048], rotSpeed: 0.09, rotAxis: [0, -0.02, 0.98] },
  { center: [-2.8, -2.4, -9.0], radiusX: 1.7, radiusY: 1.05, radiusZ: 1.3, count: 3600, opacity: 0.36, colorA: new THREE.Color('#3a2acf'), colorB: new THREE.Color('#d76bff'), sizeRange: [0.008, 0.05], rotSpeed: -0.11, rotAxis: [-0.03, -0.01, 0.95] },
  { center: [5.8, 0.55, -10.8], radiusX: 1.2, radiusY: 0.9, radiusZ: 0.95, count: 2200, opacity: 0.28, colorA: new THREE.Color('#1e7ce6'), colorB: new THREE.Color('#f3a6ff'), sizeRange: [0.006, 0.038], rotSpeed: 0.18, rotAxis: [0.04, 0.05, 0.9] },
  { center: [-6.05, -0.95, -9.8], radiusX: 1.15, radiusY: 0.85, radiusZ: 1.0, count: 2000, opacity: 0.26, colorA: new THREE.Color('#7b4dff'), colorB: new THREE.Color('#64d9ff'), sizeRange: [0.006, 0.036], rotSpeed: -0.14, rotAxis: [-0.05, 0, 0.92] },
  { center: [1.8, 0.6, -12.5], radiusX: 0.75, radiusY: 0.7, radiusZ: 0.6, count: 1200, opacity: 0.22, colorA: new THREE.Color('#d8c4ff'), colorB: new THREE.Color('#7b4dff'), sizeRange: [0.005, 0.032], rotSpeed: 0.2, rotAxis: [0.02, 0.07, 0.85] },
  { center: [-0.8, -0.55, -11.8], radiusX: 0.82, radiusY: 0.65, radiusZ: 0.7, count: 1400, opacity: 0.24, colorA: new THREE.Color('#64d9ff'), colorB: new THREE.Color('#f7d6ff'), sizeRange: [0.005, 0.034], rotSpeed: -0.22, rotAxis: [-0.06, -0.02, 0.84] },
];

export function NebulaRibbons() {
  return (
    <group>
      {CLUSTERS.map((cluster, i) => (
        <NebulaCloud key={i} cluster={cluster} />
      ))}
      <CloudBanks />
    </group>
  );
}

function NebulaCloud({ cluster }: { cluster: NebulaCluster }) {
  const groupRef = useRef<THREE.Group>(null);
  const cloud = useMemo(() => createNebulaCloud(cluster), [cluster]);

  useFrame(({ clock }) => {
    cloud.material.uniforms.uTime.value = clock.elapsedTime;
    if (groupRef.current) {
      const t = clock.elapsedTime;
      const [ax, ay, az] = cluster.rotAxis;
      groupRef.current.rotation.set(ax * t * cluster.rotSpeed, ay * t * cluster.rotSpeed, az * t * cluster.rotSpeed);
    }
  });

  return (
    <group ref={groupRef} position={cluster.center}>
      <points
        geometry={cloud.geometry}
        material={cloud.material}
        position={[-cluster.center[0], -cluster.center[1], -cluster.center[2]]}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

function createNebulaCloud(cluster: NebulaCluster) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(cluster.count * 3);
  const colors = new Float32Array(cluster.count * 3);
  const sizes = new Float32Array(cluster.count);
  const phases = new Float32Array(cluster.count);
  const alphas = new Float32Array(cluster.count);

  const [cx, cy, cz] = cluster.center;

  for (let i = 0; i < cluster.count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.52);
    const i3 = i * 3;

    const px = Math.cos(angle) * r * cluster.radiusX;
    const py = Math.sin(angle) * r * cluster.radiusY;
    const pz = THREE.MathUtils.randFloatSpread(cluster.radiusZ);

    const edgeBlend = THREE.MathUtils.clamp(r, 0, 1);
    const color = cluster.colorA.clone().lerp(cluster.colorB, edgeBlend * 0.55 + Math.random() * 0.2);
    const coreBoost = Math.exp(-r * 2.8);

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
    sizes[i] = THREE.MathUtils.randFloat(cluster.sizeRange[0], cluster.sizeRange[1]) * (0.66 + coreBoost * 0.74);
    phases[i] = Math.random() * Math.PI * 2;
    alphas[i] = cluster.opacity * THREE.MathUtils.randFloat(0.08, 0.68) * (0.26 + coreBoost * 0.74 - r * 0.2);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aPhase;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.08 + aPhase + p.y * 0.55) * 0.048;
        p.y += cos(uTime * 0.07 + aPhase + p.x * 0.38) * 0.042;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * 540.0 * uPixelRatio / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = aAlpha * (0.84 + sin(uTime * 0.18 + aPhase) * 0.12);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float alpha = smoothstep(0.5, 0.0, d) * smoothstep(0.0, 0.28, d) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  return { geometry, material };
}

function CloudBanks() {
  return (
    <>
      <Bank position={[-6.4, -3.6, -7.4]} scale={[2.4, 0.82, 1]} color="#120b2f" accent="#64d9ff" rotSpeed={0.04} />
      <Bank position={[6.6, 2.38, -8.7]} scale={[2.1, 1.35, 1]} color="#120b2f" accent="#7b4dff" rotSpeed={-0.05} />
      <Bank position={[5.95, -3.24, -6.9]} scale={[2.2, 1.0, 1]} color="#2b155d" accent="#f7d6ff" rotSpeed={0.06} />
      <Bank position={[-5.8, -1.6, -6.5]} scale={[1.6, 0.75, 1]} color="#0e0624" accent="#7b4dff" rotSpeed={-0.03} />
      <Bank position={[1.2, -2.0, -7.8]} scale={[1.8, 0.68, 1]} color="#0a0418" accent="#64d9ff" rotSpeed={0.05} />
    </>
  );
}

function Bank({ position, scale, color, accent, rotSpeed }: { position: [number, number, number]; scale: [number, number, number]; color: string; accent: string; rotSpeed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  );
  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [accent],
  );

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.z = clock.elapsedTime * rotSpeed;
  });

  return (
    <group position={position} scale={scale}>
      <mesh ref={meshRef} material={material}>
        <sphereGeometry args={[1.2, 32, 16]} />
      </mesh>
      <mesh material={glowMaterial} scale={[1.18, 1.18, 1.18]}>
        <sphereGeometry args={[1.22, 32, 16]} />
      </mesh>
    </group>
  );
}
