import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { GalaxySpiral } from './GalaxySpiral';

type SpiralEntry = {
  position: [number, number, number]; // base position, scaled at render time
  scale: number;
  rotation: [number, number, number];
  count: number;
  mistCount: number;
  radius: number;
  coreRadius: number;
  arms: number;
  spiralTightness: number;
  colorMode: 'hero' | 'bottom' | 'violet' | 'warm';
  opacity: number;
  rotSpeed: number;
  rotAxis: [number, number, number];
};

// Base spirals — pushed to perimeter, positions scaled responsively
const SPIRALS: SpiralEntry[] = [
  // Top-left
  { position: [-6.5, 3.0, -10.5], scale: 3.0, rotation: [0.08, -0.12, -0.35], count: 20000, mistCount: 3200, radius: 1.58, coreRadius: 0.24, arms: 5, spiralTightness: 3.65, colorMode: 'hero', opacity: 0.95, rotSpeed: 0.08, rotAxis: [0.01, 0, 0.99] },
  // Top-right
  { position: [6.5, 3.0, -10.0], scale: 2.5, rotation: [0.05, 0.1, 0.45], count: 15000, mistCount: 2400, radius: 1.38, coreRadius: 0.21, arms: 4, spiralTightness: 3.3, colorMode: 'bottom', opacity: 0.78, rotSpeed: -0.1, rotAxis: [-0.02, 0.01, 0.97] },
  // Bottom-left
  { position: [-6.5, -2.8, -11.5], scale: 0.85, rotation: [0.58, -0.2, -0.1], count: 1400, mistCount: 200, radius: 1.08, coreRadius: 0.15, arms: 4, spiralTightness: 3, colorMode: 'violet', opacity: 0.68, rotSpeed: 0.12, rotAxis: [0.03, 0.02, 0.95] },
  // Bottom-right
  { position: [6.5, -2.8, -10.0], scale: 0.65, rotation: [0.5, 0.08, -0.72], count: 1100, mistCount: 170, radius: 1, coreRadius: 0.14, arms: 3, spiralTightness: 3.2, colorMode: 'warm', opacity: 0.6, rotSpeed: -0.09, rotAxis: [-0.04, 0.01, 0.93] },
  // Left-middle
  { position: [-7.0, 0.2, -10.0], scale: 0.55, rotation: [0.42, -0.18, 0.46], count: 900, mistCount: 140, radius: 0.92, coreRadius: 0.13, arms: 3, spiralTightness: 3.05, colorMode: 'violet', opacity: 0.55, rotSpeed: 0.15, rotAxis: [0, -0.04, 0.94] },
  // Right-middle
  { position: [7.0, -0.3, -10.5], scale: 0.7, rotation: [0.44, 0.12, 0.18], count: 1100, mistCount: 170, radius: 0.88, coreRadius: 0.12, arms: 3, spiralTightness: 3.28, colorMode: 'violet', opacity: 0.48, rotSpeed: -0.13, rotAxis: [-0.03, -0.04, 0.92] },
];

function SpiralWrapper({ entry, xScale, yScale }: { entry: SpiralEntry; xScale: number; yScale: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const basePosition = useRef(new THREE.Vector3(entry.position[0] * xScale, entry.position[1] * yScale, entry.position[2]));

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.elapsedTime;
      const [ax, ay, az] = entry.rotAxis;
      const motion = Math.abs(entry.rotSpeed);
      groupRef.current.rotation.set(
        entry.rotation[0] * 0.28 + ax * t * entry.rotSpeed * 2.4 + Math.sin(t * 0.22 + entry.scale) * 0.035,
        entry.rotation[1] * 0.28 + ay * t * entry.rotSpeed * 2.2 + Math.cos(t * 0.18 + entry.radius) * 0.04,
        entry.rotation[2] * 0.2 + az * t * entry.rotSpeed * 2.8
      );
      groupRef.current.position.set(
        basePosition.current.x + Math.sin(t * (0.11 + motion) + entry.radius) * 0.16,
        basePosition.current.y + Math.cos(t * (0.09 + motion) + entry.scale) * 0.12,
        basePosition.current.z + Math.sin(t * (0.07 + motion * 0.5) + entry.opacity) * 0.24
      );
      const breathe = 1 + Math.sin(t * 0.24 + entry.scale) * 0.055;
      groupRef.current.scale.setScalar(breathe);
    }
  });

  const px = entry.position[0] * xScale;
  const py = entry.position[1] * yScale;

  return (
    <group ref={groupRef} position={[px, py, entry.position[2]]}>
      <GalaxySpiral
        position={[0, 0, 0]}
        scale={entry.scale}
        rotation={entry.rotation}
        count={entry.count}
        mistCount={entry.mistCount}
        radius={entry.radius}
        coreRadius={entry.coreRadius}
        arms={entry.arms}
        spiralTightness={entry.spiralTightness}
        colorMode={entry.colorMode}
        opacity={entry.opacity}
      />
    </group>
  );
}

export function GalaxyBand() {
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);
  const xScale = Math.max(0.75, Math.min(1.4, aspect / 1.78));
  const yScale = Math.max(0.8, Math.min(1.3, 1.78 / aspect));

  return (
    <>
      {SPIRALS.map((entry, i) => (
        <SpiralWrapper key={i} entry={entry} xScale={xScale} yScale={yScale} />
      ))}
    </>
  );
}
