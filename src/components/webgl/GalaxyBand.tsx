import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GalaxySpiral } from './GalaxySpiral';
import { ReferenceNebula } from './ReferenceNebula';
import { removeGalaxyPortal, updateGalaxyPortal } from './galaxyPortalRegistry';

type SpiralEntry = {
  id: string;
  orbitRadiusX: number;
  orbitRadiusY: number;
  orbitPhase: number;
  orbitSpeed: number;
  depth: number;
  spinSpeed: number;
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
};

const OUTER_ORBIT_RADIUS_X = 10.75;
const OUTER_ORBIT_RADIUS_Y = 5.05;
const OUTER_ORBIT_SPEED = 0.009;
const REFERENCE_ASPECT = 1016 / 585;

// One shared outer orbit split into six 60-degree sectors. Identical orbital
// speed preserves the spacing forever, so no two spirals can enter the same
// region or bunch together. Their local self-spin still varies independently.
const SPIRALS: SpiralEntry[] = [
  // Top-left
  { id: 'portal-0', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: Math.PI * 2 / 3, orbitSpeed: OUTER_ORBIT_SPEED, depth: -10.5, spinSpeed: 0.042, scale: 2.0, rotation: [0.19, -0.15, -0.35], count: 19000, mistCount: 1900, radius: 1.46, coreRadius: 0.24, arms: 12, spiralTightness: 4.15, colorMode: 'hero', opacity: 0.92 },
  // Top-right
  { id: 'portal-1', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: Math.PI / 3, orbitSpeed: OUTER_ORBIT_SPEED, depth: -10.0, spinSpeed: -0.036, scale: 1.65, rotation: [0.17, 0.14, 0.45], count: 17000, mistCount: 1300, radius: 1.32, coreRadius: 0.21, arms: 12, spiralTightness: 3.9, colorMode: 'bottom', opacity: 0.84 },
  // Bottom-left
  { id: 'portal-2', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: Math.PI * 4 / 3, orbitSpeed: OUTER_ORBIT_SPEED, depth: -11.5, spinSpeed: 0.034, scale: 1.25, rotation: [0.32, -0.2, -0.1], count: 15000, mistCount: 260, radius: 1.08, coreRadius: 0.15, arms: 12, spiralTightness: 3.72, colorMode: 'violet', opacity: 0.7 },
  // Bottom-right
  { id: 'portal-3', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: Math.PI * 5 / 3, orbitSpeed: OUTER_ORBIT_SPEED, depth: -10.0, spinSpeed: -0.04, scale: 1.2, rotation: [0.3, 0.08, -0.72], count: 14500, mistCount: 240, radius: 1, coreRadius: 0.14, arms: 12, spiralTightness: 3.84, colorMode: 'warm', opacity: 0.68 },
  // Left-middle
  { id: 'portal-4', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: Math.PI, orbitSpeed: OUTER_ORBIT_SPEED, depth: -10.0, spinSpeed: 0.048, scale: 1.0, rotation: [0.28, -0.18, 0.46], count: 14000, mistCount: 180, radius: 0.92, coreRadius: 0.13, arms: 12, spiralTightness: 3.62, colorMode: 'violet', opacity: 0.6 },
  // Right-middle
  { id: 'portal-5', orbitRadiusX: OUTER_ORBIT_RADIUS_X, orbitRadiusY: OUTER_ORBIT_RADIUS_Y, orbitPhase: 0, orbitSpeed: OUTER_ORBIT_SPEED, depth: -10.5, spinSpeed: -0.045, scale: 1.05, rotation: [0.28, 0.12, 0.18], count: 14000, mistCount: 190, radius: 0.88, coreRadius: 0.12, arms: 12, spiralTightness: 3.7, colorMode: 'violet', opacity: 0.58 },
];

function SpiralWrapper({ entry, xScale, yScale }: { entry: SpiralEntry; xScale: number; yScale: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const portalPositionRef = useRef(new THREE.Vector3());
  const portalVelocityRef = useRef(new THREE.Vector3());
  const portalNormalRef = useRef(new THREE.Vector3(0, 0, 1));
  const initialX = Math.cos(entry.orbitPhase) * entry.orbitRadiusX * xScale;
  const initialY = Math.sin(entry.orbitPhase) * entry.orbitRadiusY * yScale;
  const previousPortalPositionRef = useRef(new THREE.Vector3(initialX, initialY, entry.depth));

  useFrame(({ clock, camera }, delta) => {
    if (!groupRef.current) return;
    const angle = entry.orbitPhase + clock.elapsedTime * entry.orbitSpeed;
    groupRef.current.position.set(
      Math.cos(angle) * entry.orbitRadiusX * xScale,
      Math.sin(angle) * entry.orbitRadiusY * yScale,
      entry.depth
    );
    groupRef.current.updateWorldMatrix(true, false);
    groupRef.current.getWorldPosition(portalPositionRef.current);
    portalVelocityRef.current
      .subVectors(portalPositionRef.current, previousPortalPositionRef.current)
      .multiplyScalar(1 / Math.max(delta, 0.001));
    previousPortalPositionRef.current.copy(portalPositionRef.current);
    portalNormalRef.current
      .subVectors(camera.position, portalPositionRef.current)
      .normalize();
    const visualRadius = entry.radius * entry.scale;
    const apertureRadius = Math.max(0.72, visualRadius * 0.32);
    updateGalaxyPortal(
      entry.id,
      portalPositionRef.current,
      portalNormalRef.current,
      portalVelocityRef.current,
      Math.max(0.12, apertureRadius - 0.1),
      apertureRadius,
      visualRadius
    );
  });

  useEffect(() => () => removeGalaxyPortal(entry.id), [entry.id]);

  return (
    <group ref={groupRef} position={[initialX, initialY, entry.depth]}>
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
        spinSpeed={entry.spinSpeed}
      />
    </group>
  );
}

function ReferenceNebulaPreview({ animated }: { animated: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const viewDirection = useRef(new THREE.Vector3()).current;
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    if (!groupRef.current || !(camera instanceof THREE.PerspectiveCamera)) return;

    const distance = 0.5;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * distance;
    camera.getWorldDirection(viewDirection);
    groupRef.current.position.copy(camera.position).addScaledVector(viewDirection, distance);
    groupRef.current.quaternion.copy(camera.quaternion);
    groupRef.current.scale.setScalar(height);
  });

  return (
    <group ref={groupRef}>
      <ReferenceNebula
        radius={REFERENCE_ASPECT * 0.5}
        opacity={1}
        brightness={1}
        contrast={1}
        saturation={1}
        flowStrength={animated ? 0.0066 : 0}
        flowSpeed={animated ? 1 / 24 : 0}
        edgeFade={animated ? 0.075 : 0}
        depthTest={false}
        opaqueReference={!animated}
        renderOrder={10000}
      />
    </group>
  );
}

export function GalaxyBand() {
  const { width, height } = useThree((state) => state.size);
  const aspect = width / Math.max(height, 1);
  const xScale = THREE.MathUtils.clamp(aspect / (16 / 10), 0.9, 1.38);
  const yScale = THREE.MathUtils.clamp((16 / 10) / aspect, 0.92, 1.25);
  const previewMode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('nebulaPreview')
    : null;

  if (previewMode === '1' || previewMode === 'flow') {
    return <ReferenceNebulaPreview animated={previewMode === 'flow'} />;
  }

  return (
    <group>
      {SPIRALS.map((entry) => (
        <SpiralWrapper
          key={entry.id}
          entry={entry}
          xScale={xScale}
          yScale={yScale}
        />
      ))}
    </group>
  );
}
