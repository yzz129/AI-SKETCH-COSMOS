import type { StoredArtwork } from '../../stores/artworkStore';
import { SpaceCreature } from './SpaceCreature';

type ArtworkEntityProps = {
  artwork: StoredArtwork;
  index: number;
};

export function ArtworkEntity({ artwork, index }: ArtworkEntityProps) {
  return <SpaceCreature artwork={artwork} index={index} />;
}
