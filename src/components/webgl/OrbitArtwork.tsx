import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { ArtworkEntity } from './ArtworkEntity';
import { RestingCreatureBubbleField } from './RestingCreatureBubbleField';
import {
  CREATURE_BUBBLE_ROTATION_MS,
  type CreatureBubbleScreenAnchor,
  getCreatureBubbleScreenAnchor,
  getCreatureCrowdScale,
  MAX_ACTIVE_CREATURES,
  replaceActiveCreatureIds,
  setInitialCreatureAdmissionSettled,
  selectBubbledCreatureIds
} from './creatureActivity';
import { useCreatureEvolutionStore } from './creatureEvolutionStore';

const ACTIVITY_HANDOFF_DURATION_MS = 4_800;
const ACTIVITY_REPLACEMENTS_PER_CYCLE = 2;
const INITIAL_ACTIVE_ADMISSION_INTERVAL_MS = 3_200;
const INITIAL_ACTIVE_ENTRY_SETTLE_MS = 3_000;
const RECENT_UPLOAD_MIN_VISIBLE_MS = 120_000;
const LOCAL_STRESS_ARTWORK_PREFIX = 'local-stress:';
const MAX_ROTATION_PROTECTED_CREATURES = Math.max(
  1,
  MAX_ACTIVE_CREATURES - ACTIVITY_REPLACEMENTS_PER_CYCLE
);

export function OrbitArtwork() {
  const artworks = useArtworkStore((state) => state.artworks);
  const victoryCounts = useCreatureEvolutionStore(useShallow((state) => (
    artworks.map((artwork) => state.records[artwork.id]?.victories ?? 0)
  )));
  const activeCreatureId = useSketchStore((state) => state.spotlight.creatureId);
  const requestedCreatureId = useSketchStore((state) => state.spotlight.requestedCreatureId);
  const pendingCreatureId = useSketchStore((state) => state.spotlight.pendingCreatureId);
  const stableIndexesRef = useRef(new Map<string, number>());
  const bubbleSlotsRef = useRef(new Map<string, number>());
  const lastBubbleSlotsRef = useRef(new Map<string, number>());
  const nextStableIndexRef = useRef(0);
  const [activityOffset, setActivityOffset] = useState(0);
  const [renderedEntityIds, setRenderedEntityIds] = useState<Set<string>>(() => new Set());
  const [admittedActiveIds, setAdmittedActiveIds] = useState<Set<string>>(() => new Set());
  const [initialAdmissionSettled, setInitialAdmissionSettled] = useState(false);
  const [recentUploadProtectedUntilById, setRecentUploadProtectedUntilById] = useState<Map<string, number>>(
    () => new Map()
  );
  const [restAnchorsById, setRestAnchorsById] = useState<Map<string, CreatureBubbleScreenAnchor>>(
    () => new Map()
  );
  const retirementTimersRef = useRef(new Map<string, number>());
  const previousActiveIdsRef = useRef(new Set<string>());
  const activeIdsRef = useRef(new Set<string>());
  const everActiveIdsRef = useRef(new Set<string>());
  const knownArtworkIdsRef = useRef(new Set<string>());
  const pendingRecentUploadIdsRef = useRef(new Set<string>());
  const activeAdmissionStartedRef = useRef(false);
  const orderedArtworks = useMemo(
    () => [...artworks].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    [artworks]
  );
  const visibleArtworks = useMemo(() => {
    for (const artwork of orderedArtworks) {
      if (!stableIndexesRef.current.has(artwork.id)) {
        stableIndexesRef.current.set(artwork.id, nextStableIndexRef.current++);
      }
    }
    return orderedArtworks
      .map((artwork) => ({
        artwork,
        globalIndex: stableIndexesRef.current.get(artwork.id) ?? 0
      }));
  }, [orderedArtworks]);
  const victoriesById = useMemo(() => new Map(
    artworks.map((artwork, artworkIndex) => [artwork.id, victoryCounts[artworkIndex] ?? 0] as const)
  ), [artworks, victoryCounts]);
  const bubblePriorityIds = useMemo(() => visibleArtworks
    .map(({ artwork }) => artwork)
    .sort((left, right) => (
      (victoriesById.get(right.id) ?? 0) - (victoriesById.get(left.id) ?? 0)
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id)
    ))
    .map((artwork) => artwork.id), [victoriesById, visibleArtworks]);
  const latestArtworkId = orderedArtworks[orderedArtworks.length - 1]?.id ?? null;
  const rotationProtectedIds = useMemo(() => {
    const availableIds = new Set(bubblePriorityIds);
    const candidates = [
      activeCreatureId,
      requestedCreatureId,
      pendingCreatureId,
      latestArtworkId,
      ...[...recentUploadProtectedUntilById.entries()]
        .filter(([id, protectedUntil]) => availableIds.has(id) && protectedUntil > Date.now())
        .sort((left, right) => right[1] - left[1])
        .map(([id]) => id)
    ];
    const protectedIds: string[] = [];
    const seenIds = new Set<string>();
    for (const id of candidates) {
      if (!id || seenIds.has(id) || !availableIds.has(id)) continue;
      protectedIds.push(id);
      seenIds.add(id);
      if (protectedIds.length >= MAX_ROTATION_PROTECTED_CREATURES) break;
    }
    return protectedIds;
  }, [
    activeCreatureId,
    activityOffset,
    bubblePriorityIds,
    latestArtworkId,
    pendingCreatureId,
    recentUploadProtectedUntilById,
    requestedCreatureId
  ]);
  const bubbledIds = useMemo(() => selectBubbledCreatureIds(
    bubblePriorityIds,
    activityOffset,
    rotationProtectedIds
  ), [activityOffset, bubblePriorityIds, rotationProtectedIds]);
  const bubbledIdSet = useMemo(() => new Set(bubbledIds), [bubbledIds]);
  const bubbleOrderById = useMemo(() => {
    const nextBubbledIds = new Set(bubbledIds);
    const nextSlots = new Map<string, number>();
    const occupiedSlots = new Set<number>();

    for (const [id, slot] of bubbleSlotsRef.current) {
      if (!nextBubbledIds.has(id) || slot >= bubbledIds.length) continue;
      nextSlots.set(id, slot);
      occupiedSlots.add(slot);
    }

    const freeSlots: number[] = [];
    for (let slot = 0; slot < bubbledIds.length; slot += 1) {
      if (!occupiedSlots.has(slot)) freeSlots.push(slot);
    }
    for (const id of bubbledIds) {
      if (nextSlots.has(id)) continue;
      const slot = freeSlots.shift();
      if (slot === undefined) break;
      nextSlots.set(id, slot);
    }

    bubbleSlotsRef.current = nextSlots;
    for (const [id, slot] of nextSlots) lastBubbleSlotsRef.current.set(id, slot);
    return nextSlots;
  }, [bubbledIds]);
  const activeIds = useMemo(() => new Set(
    visibleArtworks
      .map(({ artwork }) => artwork.id)
      .filter((id) => !bubbledIdSet.has(id))
  ), [bubbledIdSet, visibleArtworks]);
  const renderActiveIds = useMemo(() => new Set(
    [...activeIds].filter((id) => admittedActiveIds.has(id))
  ), [activeIds, admittedActiveIds]);
  const activeAdmissionComplete = renderActiveIds.size === activeIds.size;
  const displayRestAnchorsById = useMemo(() => {
    const next = new Map<string, CreatureBubbleScreenAnchor>();
    for (const { artwork } of visibleArtworks) {
      const capturedAnchor = restAnchorsById.get(artwork.id);
      if (capturedAnchor) {
        next.set(artwork.id, capturedAnchor);
        continue;
      }
      const slot = bubbleOrderById.get(artwork.id)
        ?? lastBubbleSlotsRef.current.get(artwork.id)
        ?? stableIndexesRef.current.get(artwork.id)
        ?? 0;
      next.set(
        artwork.id,
        getCreatureBubbleScreenAnchor(slot, bubbledIds.length)
      );
    }
    return next;
  }, [bubbleOrderById, bubbledIds.length, restAnchorsById, visibleArtworks]);
  const entityIdSet = useMemo(() => new Set([
    ...renderedEntityIds,
    ...renderActiveIds
  ]), [renderActiveIds, renderedEntityIds]);
  const crowdScale = getCreatureCrowdScale(visibleArtworks.length);
  const restingBubbleEntries = useMemo(() => visibleArtworks
    .filter(({ artwork }) => (
      (
        everActiveIdsRef.current.has(artwork.id)
        || artwork.id.startsWith(LOCAL_STRESS_ARTWORK_PREFIX)
      )
      && !entityIdSet.has(artwork.id)
    ))
    .map(({ artwork }) => ({
      id: artwork.id,
      previewUrl: artwork.gaussianModel?.previewUrl || artwork.url,
      bubbleIndex: bubbleOrderById.get(artwork.id)
        ?? lastBubbleSlotsRef.current.get(artwork.id)
        ?? 0,
      anchor: displayRestAnchorsById.get(artwork.id)
    })), [
      bubbleOrderById,
      entityIdSet,
      displayRestAnchorsById,
      visibleArtworks
    ]);
  const bubbleAtlasSources = useMemo(() => orderedArtworks
    .map((artwork) => artwork.gaussianModel?.previewUrl || artwork.url)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right)), [orderedArtworks]);

  const captureRestAnchor = useCallback((id: string, anchor: CreatureBubbleScreenAnchor) => {
    setRestAnchorsById((current) => {
      const previous = current.get(id);
      if (previous
        && Math.abs(previous.x - anchor.x) < 0.002
        && Math.abs(previous.y - anchor.y) < 0.002
        && Math.abs(previous.depth - anchor.depth) < 0.05
        && Math.abs((previous.pointSize ?? 0) - (anchor.pointSize ?? 0)) < 0.5) {
        return current;
      }
      const next = new Map(current);
      next.set(id, anchor);
      return next;
    });
  }, []);

  useEffect(() => {
    const targetIds = [...activeIds];
    if (targetIds.length === 0) {
      activeAdmissionStartedRef.current = false;
      setAdmittedActiveIds((current) => current.size === 0 ? current : new Set());
      return;
    }

    setAdmittedActiveIds((current) => {
      const next = new Set([...current].filter((id) => activeIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });

    const nextId = targetIds.find((id) => !admittedActiveIds.has(id));
    if (!nextId) return;
    const delay = activeAdmissionStartedRef.current
      ? INITIAL_ACTIVE_ADMISSION_INTERVAL_MS
      : 0;
    activeAdmissionStartedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      setAdmittedActiveIds((current) => {
        if (current.has(nextId) || !activeIds.has(nextId)) return current;
        const next = new Set(current);
        next.add(nextId);
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [activeIds, admittedActiveIds]);

  useEffect(() => {
    replaceActiveCreatureIds(renderActiveIds);
    activeIdsRef.current = renderActiveIds;
    for (const id of renderActiveIds) everActiveIdsRef.current.add(id);
    const newlyVisibleUploadIds = [...renderActiveIds].filter((id) => (
      pendingRecentUploadIdsRef.current.has(id)
    ));
    if (newlyVisibleUploadIds.length > 0) {
      const protectedUntil = Date.now() + RECENT_UPLOAD_MIN_VISIBLE_MS;
      for (const id of newlyVisibleUploadIds) pendingRecentUploadIdsRef.current.delete(id);
      setRecentUploadProtectedUntilById((current) => {
        const next = new Map(current);
        for (const id of newlyVisibleUploadIds) next.set(id, protectedUntil);
        return next;
      });
    }
  }, [renderActiveIds]);

  useEffect(() => {
    if (initialAdmissionSettled || activeIds.size === 0 || !activeAdmissionComplete) return;
    const timeoutId = window.setTimeout(() => {
      setInitialAdmissionSettled(true);
    }, INITIAL_ACTIVE_ENTRY_SETTLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeAdmissionComplete, activeIds.size, initialAdmissionSettled]);

  useEffect(() => {
    setInitialCreatureAdmissionSettled(initialAdmissionSettled);
  }, [initialAdmissionSettled]);

  useEffect(() => () => {
    setInitialCreatureAdmissionSettled(false);
  }, []);

  useEffect(() => {
    const nextActiveIds = new Set(renderActiveIds);
    const previousActiveIds = previousActiveIdsRef.current;
    for (const id of nextActiveIds) {
      const timerId = retirementTimersRef.current.get(id);
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
        retirementTimersRef.current.delete(id);
      }
    }

    setRenderedEntityIds((current) => {
      const next = new Set(current);
      for (const id of nextActiveIds) next.add(id);
      return next;
    });

    for (const id of previousActiveIds) {
      if (nextActiveIds.has(id) || retirementTimersRef.current.has(id)) continue;
      const timerId = window.setTimeout(() => {
        retirementTimersRef.current.delete(id);
        if (activeIdsRef.current.has(id)) return;
        setRenderedEntityIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, ACTIVITY_HANDOFF_DURATION_MS);
      retirementTimersRef.current.set(id, timerId);
    }

    previousActiveIdsRef.current = nextActiveIds;
  }, [renderActiveIds]);

  useEffect(() => () => {
    for (const timerId of retirementTimersRef.current.values()) window.clearTimeout(timerId);
    retirementTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const existingIds = new Set(artworks.map((artwork) => artwork.id));
    const newIds = artworks
      .map((artwork) => artwork.id)
      .filter((id) => !knownArtworkIdsRef.current.has(id));
    knownArtworkIdsRef.current = existingIds;
    if (initialAdmissionSettled) {
      for (const id of newIds) pendingRecentUploadIdsRef.current.add(id);
    }
    for (const id of pendingRecentUploadIdsRef.current) {
      if (!existingIds.has(id)) pendingRecentUploadIdsRef.current.delete(id);
    }
    for (const id of everActiveIdsRef.current) {
      if (!existingIds.has(id)) everActiveIdsRef.current.delete(id);
    }
    setRecentUploadProtectedUntilById((current) => {
      const next = new Map(
        [...current].filter(([id]) => existingIds.has(id))
      );
      if (
        next.size === current.size
        && [...next].every(([id, value]) => current.get(id) === value)
      ) return current;
      return next;
    });
    setRestAnchorsById((current) => {
      if ([...current.keys()].every((id) => existingIds.has(id))) return current;
      return new Map([...current].filter(([id]) => existingIds.has(id)));
    });
  }, [artworks, initialAdmissionSettled]);

  useEffect(() => {
    if (visibleArtworks.length <= MAX_ACTIVE_CREATURES) return;
    if (!initialAdmissionSettled) return;
    if (!activeAdmissionComplete) return;
    const replacementsPerCycle = Math.min(
      ACTIVITY_REPLACEMENTS_PER_CYCLE,
      bubbledIds.length
    );
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setRecentUploadProtectedUntilById((current) => {
        const next = new Map(
          [...current].filter(([, protectedUntil]) => protectedUntil > now)
        );
        return next.size === current.size ? current : next;
      });
      setActivityOffset((current) => (
        current + replacementsPerCycle
      ) % visibleArtworks.length);
    }, CREATURE_BUBBLE_ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [activeAdmissionComplete, bubbledIds.length, initialAdmissionSettled, visibleArtworks.length]);

  return (
    <>
      {initialAdmissionSettled ? (
        <RestingCreatureBubbleField
          entries={restingBubbleEntries}
          atlasSources={bubbleAtlasSources}
          bubbleCount={restingBubbleEntries.length}
        />
      ) : null}
      {visibleArtworks.filter(({ artwork }) => entityIdSet.has(artwork.id)).map(({ artwork, globalIndex }) => (
        <ArtworkEntity
          key={artwork.id}
          artwork={artwork}
          index={globalIndex}
          active={renderActiveIds.has(artwork.id)}
          bubbleIndex={bubbleOrderById.get(artwork.id)
            ?? lastBubbleSlotsRef.current.get(artwork.id)
            ?? globalIndex}
          bubbleCount={bubbledIds.length}
          crowdScale={crowdScale}
          ambientMotionEnabled={initialAdmissionSettled}
          restAnchor={everActiveIdsRef.current.has(artwork.id)
            ? displayRestAnchorsById.get(artwork.id)
            : undefined}
          onRestAnchorCapture={captureRestAnchor}
          showEntryTrail={false}
        />
      ))}
    </>
  );
}
