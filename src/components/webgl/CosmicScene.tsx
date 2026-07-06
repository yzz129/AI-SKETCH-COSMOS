import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useState } from 'react';
import { CameraRig } from './CameraRig';
import { DeepSpaceBackground } from './DeepSpaceBackground';
import { Lighting } from './Lighting';
import { MeteorLayer } from './MeteorLayer';
import { OrbitArtwork } from './OrbitArtwork';
import { PointerInteractionField } from './PointerInteractionField';
import { SpotlightDirector } from './SpotlightDirector';
import { StarFood } from './StarFood';

/**
 * Adjusts the camera FOV so the 3D scene scales proportionally
 * with the viewport.  Smaller FOV → objects appear larger.
 * Reference: FOV 50 at 1440 px → FOV 35 at 2560 px.
 */
function ResponsiveCamera() {
  const { camera } = useThree();
  const baseFov = 50;
  const baseWidth = 1440;

  const computeFov = useCallback(() => {
    const w = window.innerWidth;
    // tan(halfFov) ∝ 1/scale  →  scale = w / baseWidth
    const scale = Math.min(1.55, Math.max(0.78, w / baseWidth));
    const halfRad = Math.atan(Math.tan((baseFov * Math.PI) / 360) / scale);
    return (halfRad * 360) / Math.PI;
  }, []);

  const [fov, setFov] = useState(computeFov);

  useEffect(() => {
    const update = () => setFov(computeFov());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [computeFov]);

  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, fov]);

  return null;
}

export function CosmicScene() {
  return (
    <>
      <ResponsiveCamera />
      <fogExp2 attach="fog" args={['#120b2f', 0.025]} />
      <CameraRig />
      <DeepSpaceBackground />
      <PointerInteractionField />
      <StarFood />
      <MeteorLayer />
      <Lighting />
      <SpotlightDirector />
      <OrbitArtwork />
    </>
  );
}
