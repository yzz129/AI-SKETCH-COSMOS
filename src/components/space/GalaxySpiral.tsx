import * as THREE from 'three';
import { ReferenceNebula } from '../webgl/ReferenceNebula';

type GalaxySpiralProps = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  count: number;
  radius: number;
  coreRadius: number;
  arms: number;
  spin: number;
  brightness: number;
};

/**
 * Legacy scene entry retained for CosmicDisplay compatibility.
 * It now shares the same reference-driven nebula used by the active WebGL
 * scene instead of maintaining a second procedural particle implementation.
 */
export function GalaxySpiral({
  position,
  rotation,
  scale,
  radius,
  brightness
}: GalaxySpiralProps) {
  return (
    <ReferenceNebula
      position={position}
      rotation={rotation}
      scale={scale}
      radius={radius}
      opacity={THREE.MathUtils.clamp(brightness, 0, 1)}
      brightness={1}
      contrast={1}
      saturation={1}
      flowStrength={0.0066}
      flowSpeed={1 / 32}
      coreProtection={0.13}
      edgeFade={0.075}
    />
  );
}
