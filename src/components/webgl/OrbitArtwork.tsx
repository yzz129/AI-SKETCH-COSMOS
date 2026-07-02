import { useArtworkStore } from '../../stores/artworkStore';
import { ArtworkEntity } from './ArtworkEntity';

export function OrbitArtwork() {
  const artworks = useArtworkStore((state) => state.artworks);

  return (
    <>
      {artworks.map((artwork, index) => (
        <ArtworkEntity key={artwork.id} artwork={artwork} index={index} />
      ))}
    </>
  );
}
