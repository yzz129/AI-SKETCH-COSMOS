import { GalaxyParticleNebula } from './GalaxyParticleNebula';

export type GalaxySpiralProps = {
  position: [number, number, number];
  scale: number;
  rotation?: [number, number, number];
  count: number;
  mistCount?: number;
  radius: number;
  coreRadius: number;
  arms: number;
  spiralTightness: number;
  stretchX?: number;
  stretchY?: number;
  colorMode?: 'hero' | 'bottom' | 'violet' | 'warm';
  opacity?: number;
  spinSpeed?: number;
};

/**
 * Compatibility wrapper for the six orbiting galaxies in GalaxyBand.
 *
 * The reference image is sampled into a true 3D GPU particle field. Legacy
 * shape parameters remain in the public type so GalaxyBand can keep its
 * established placement, scale, orbit and opacity configuration.
 */
export function GalaxySpiral({
  position,
  scale,
  rotation = [0, 0, 0],
  count,
  radius,
  opacity = 1,
  spinSpeed = 0.04
}: GalaxySpiralProps) {
  return (
    <group position={position} scale={scale}>
      <GalaxyParticleNebula
        radius={radius}
        count={Math.max(count, 14000)}
        opacity={opacity}
        spinSpeed={spinSpeed}
        roll={rotation[2]}
        renderOrder={3}
      />
    </group>
  );
}
