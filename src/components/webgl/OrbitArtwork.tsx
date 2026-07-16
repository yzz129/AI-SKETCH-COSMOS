import { useEffect, useMemo, useRef, useState } from 'react';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { ArtworkEntity } from './ArtworkEntity';

const INITIAL_MODEL_COUNT = 2;
const INITIAL_MODEL_STAGGER_MS = 560;

export function OrbitArtwork() {
  const artworks = useArtworkStore((state) => state.artworks);
  const activeCreatureId = useSketchStore((state) => state.spotlight.creatureId);
  const requestedCreatureId = useSketchStore((state) => state.spotlight.requestedCreatureId);
  const pendingCreatureId = useSketchStore((state) => state.spotlight.pendingCreatureId);
  const admittedIdsRef = useRef(new Set<string>());
  const stableIndexesRef = useRef(new Map<string, number>());
  const nextStableIndexRef = useRef(0);
  const [mountedCount, setMountedCount] = useState(0);
  const targetVisibleCount = artworks.length;
  const visibleCount = Math.min(mountedCount, targetVisibleCount);
  const orderedArtworks = useMemo(
    () => [...artworks].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    [artworks]
  );

  const visibleArtworks = useMemo(() => {
    const existingIds = new Set(artworks.map((artwork) => artwork.id));
    for (const id of admittedIdsRef.current) {
      if (!existingIds.has(id)) admittedIdsRef.current.delete(id);
    }
    for (const artwork of orderedArtworks) {
      if (!stableIndexesRef.current.has(artwork.id)) {
        stableIndexesRef.current.set(artwork.id, nextStableIndexRef.current++);
      }
    }
    for (const artwork of orderedArtworks.slice(0, visibleCount)) {
      admittedIdsRef.current.add(artwork.id);
    }
    for (const priorityId of [activeCreatureId, requestedCreatureId, pendingCreatureId]) {
      if (priorityId && existingIds.has(priorityId)) admittedIdsRef.current.add(priorityId);
    }
    return orderedArtworks
      .filter((artwork) => admittedIdsRef.current.has(artwork.id))
      .map((artwork) => ({
        artwork,
        globalIndex: stableIndexesRef.current.get(artwork.id) ?? 0
      }));
  }, [activeCreatureId, artworks, orderedArtworks, pendingCreatureId, requestedCreatureId, visibleCount]);

  useEffect(() => {
    if (targetVisibleCount === 0) {
      setMountedCount(0);
      return;
    }

    setMountedCount((current) => current === 0
      ? Math.min(INITIAL_MODEL_COUNT, targetVisibleCount)
      : Math.min(current, targetVisibleCount));

    const intervalId = window.setInterval(() => {
      setMountedCount((current) => {
        if (current >= targetVisibleCount) {
          window.clearInterval(intervalId);
          return current;
        }
        return current + 1;
      });
    }, INITIAL_MODEL_STAGGER_MS);

    return () => window.clearInterval(intervalId);
  }, [targetVisibleCount]);

  return (
    <>
      {visibleArtworks.map(({ artwork, globalIndex }) => (
        <ArtworkEntity
          key={artwork.id}
          artwork={artwork}
          index={globalIndex}
          showEntryTrail={false}
        />
      ))}
    </>
  );
}
