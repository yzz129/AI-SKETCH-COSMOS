import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { AutoCosmicInteractions } from './AutoCosmicInteractions';
import { CameraRig } from './CameraRig';
import { SpotlightEntryFireworks } from './CreatureEventParticles';
import { DeepSpaceBackground } from './DeepSpaceBackground';
import { Lighting } from './Lighting';
import { MeteorLayer } from './MeteorLayer';
import { OrbitArtwork } from './OrbitArtwork';
import { PointerInteractionField } from './PointerInteractionField';
import { SpotlightDirector } from './SpotlightDirector';
import { StarFood } from './StarFood';

/**
 * Uses a contain-style FOV: wide screens keep the reference framing, while
 * narrow screens widen the vertical field enough to preserve horizontal
 * scene coverage. R3F already tracks the canvas size, so no window listener
 * or per-frame React update is needed.
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const baseFov = 60;
    const baseAspect = 16 / 10;
    const aspect = Math.max(0.35, size.width / Math.max(size.height, 1));
    const containScale = Math.max(1, baseAspect / aspect);
    const halfRad = Math.atan(Math.tan((baseFov * Math.PI) / 360) * containScale);
    const fov = THREE.MathUtils.clamp((halfRad * 360) / Math.PI, baseFov, 115);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  return null;
}

export function CosmicScene() {
  return (
    <>
      <ResponsiveCamera />
      <fogExp2 attach="fog" args={['#120b2f', 0.025]} />
      <CameraRig />
      <DeepSpaceBackground />
      <AutoCosmicInteractions />
      <PointerInteractionField />
      <StarFood />
      <MeteorLayer />
      <Lighting />
      <SpotlightDirector />
      <SpotlightEntryFireworks />
      <OrbitArtwork />
    </>
  );
}
