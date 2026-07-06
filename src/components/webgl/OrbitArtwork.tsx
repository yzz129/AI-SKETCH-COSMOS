import { useEffect, useState } from 'react';
import { useArtworkStore } from '../../stores/artworkStore';
import { ArtworkEntity } from './ArtworkEntity';

export function OrbitArtwork() {
  const artworks = useArtworkStore((state) => state.artworks);
  const [visibleCount, setVisibleCount] = useState(0);
  const newestArtworkId = artworks[0]?.id ?? null;

  useEffect(() => {
    if (artworks.length === 0) {
      setVisibleCount(0);
      return;
    }

    setVisibleCount(Math.min(2, artworks.length));

    let mounted = true;
    let nextCount = Math.min(2, artworks.length);
    const intervalId = window.setInterval(() => {
      if (!mounted) return;

      nextCount += 1;
      setVisibleCount(Math.min(nextCount, artworks.length));

      if (nextCount >= artworks.length) {
        window.clearInterval(intervalId);
      }
    }, 850);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [artworks.length, newestArtworkId]);

  return (
    <>
      {artworks.slice(0, visibleCount).map((artwork, index) => (
        <ArtworkEntity key={artwork.id} artwork={artwork} index={index} />
      ))}
    </>
  );
}
