import { useEffect, useRef, useState } from 'react';
import { useArtworkStore } from '../../stores/artworkStore';
import { ArtworkEntity } from './ArtworkEntity';

const MAX_ACTIVE_ARTWORKS = 50;

export function OrbitArtwork() {
  const artworks = useArtworkStore((state) => state.artworks);
  const activeArtworks = artworks.slice(0, MAX_ACTIVE_ARTWORKS);
  const [visibleCount, setVisibleCount] = useState(0);
  const previousLengthRef = useRef(0);

  useEffect(() => {
    const activeLength = activeArtworks.length;
    const previousLength = previousLengthRef.current;
    previousLengthRef.current = activeLength;

    if (activeLength === 0) {
      setVisibleCount(0);
      return;
    }

    if (previousLength > 0) {
      setVisibleCount((count) => {
        if (activeLength > previousLength) {
          return Math.min(activeLength, count + activeLength - previousLength);
        }
        return Math.min(count, activeLength);
      });
      return;
    }

    setVisibleCount(Math.min(2, activeLength));

    let mounted = true;
    let nextCount = Math.min(2, activeLength);
    const intervalId = window.setInterval(() => {
      if (!mounted) return;

      nextCount += 1;
      setVisibleCount(Math.min(nextCount, activeLength));

      if (nextCount >= activeLength) {
        window.clearInterval(intervalId);
      }
    }, 850);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeArtworks.length]);

  return (
    <>
      {activeArtworks.slice(0, visibleCount).map((artwork, index) => (
        <ArtworkEntity key={artwork.id} artwork={artwork} index={index} />
      ))}
    </>
  );
}
