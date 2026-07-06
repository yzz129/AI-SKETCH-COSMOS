import { CameraRig } from './CameraRig';
import { DeepSpaceBackground } from './DeepSpaceBackground';
import { Lighting } from './Lighting';
import { MeteorLayer } from './MeteorLayer';
import { OrbitArtwork } from './OrbitArtwork';
import { PointerInteractionField } from './PointerInteractionField';
import { SpotlightDirector } from './SpotlightDirector';
import { StarFood } from './StarFood';

export function CosmicScene() {
  return (
    <>
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
