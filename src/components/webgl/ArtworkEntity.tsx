import type { StoredArtwork } from '../../stores/artworkStore';
import { SpaceCreature } from './SpaceCreature';

type ArtworkEntityProps = {
  artwork: StoredArtwork;
  index: number;
  showEntryTrail?: boolean;
};

export function ArtworkEntity({ artwork, index, showEntryTrail = false }: ArtworkEntityProps) {
  return <SpaceCreature artwork={artwork} index={index} showEntryTrail={showEntryTrail} />;
}
