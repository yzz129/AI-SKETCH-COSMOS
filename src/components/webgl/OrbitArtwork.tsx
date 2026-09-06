import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { ArtworkEntity } from './ArtworkEntity';
import {
  PersistentExhibitionModels,
  type DesignerDisplayCatalogEntry
} from './PersistentExhibitionModels';
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
import {
  ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY,
  DYNAMIC_MODEL_ROTATION_MS,
  DYNAMIC_MODELS_REPLACED_PER_CYCLE,
  getNewestModelWindowOffset,
  MAX_VARIABLE_DISPLAY_MODELS,
  mergeDynamicDisplayQueues,
  normalizeVariableModelLimit,
  prioritizeActiveModelIds,
  selectRotatingModels
} from './displayModelPolicy';

const ACTIVITY_REPLACEMENTS_PER_CYCLE = 2;
// Keep the 17-model foreground admission spread over a short startup window.
const INITIAL_ACTIVE_ADMISSION_INTERVAL_MS = 1_600;
const INITIAL_ACTIVE_ENTRY_SETTLE_MS = 3_000;
const RECENT_UPLOAD_MIN_VISIBLE_MS = 120_000;
const SPLAT_SHOWCASE_INITIAL_DELAY_MS = 15_000;
const SPLAT_SHOWCASE_INTERVAL_MS = 30_000;
const LOCAL_STRESS_ARTWORK_PREFIX = 'local-stress:';
const MAX_ROTATION_PROTECTED_CREATURES = Math.max(
  1,
  MAX_ACTIVE_CREATURES - ACTIVITY_REPLACEMENTS_PER_CYCLE
);

type DynamicModelQueueEntry = {
  key: string;
  kind: 'submit' | 'designer';
  id: string;
  createdAt: number;
};

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
  const [designerCatalog, setDesignerCatalog] = useState<readonly DesignerDisplayCatalogEntry[]>([]);
  const [dynamicRotationOffset, setDynamicRotationOffset] = useState(0);
  const [variableModelLimit] = useState(() => {
    try {
      const stored = window.sessionStorage.getItem(ADAPTIVE_VARIABLE_MODEL_LIMIT_STORAGE_KEY);
      return stored === null
        ? MAX_VARIABLE_DISPLAY_MODELS
        : normalizeVariableModelLimit(Number(stored));
    } catch {
      return MAX_VARIABLE_DISPLAY_MODELS;
    }
  });
  const [exhibitionReady, setExhibitionReady] = useState(false);
  const [admittedActiveIds, setAdmittedActiveIds] = useState<Set<string>>(() => new Set());
  const [initialAdmissionSettled, setInitialAdmissionSettled] = useState(false);
  const [recentUploadProtectedUntilById, setRecentUploadProtectedUntilById] = useState<Map<string, number>>(
    () => new Map()
  );
  const [restAnchorsById, setRestAnchorsById] = useState<Map<string, CreatureBubbleScreenAnchor>>(
    () => new Map()
  );
  const everActiveIdsRef = useRef(new Set<string>());
  const knownArtworkIdsRef = useRef(new Set<string>());
  const pendingRecentUploadIdsRef = useRef(new Set<string>());
  const displayedArtworkIdsRef = useRef(new Set<string>());
  const activeAdmissionStartedRef = useRef(false);
  const lastShowcasedSplatIdRef = useRef<string | null>(null);
  const persistentArtworks = useMemo(
    () => [...artworks].sort((left, right) => (
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    )),
    [artworks]
  );
  const dynamicQueue = useMemo(() => mergeDynamicDisplayQueues<DynamicModelQueueEntry>(
    persistentArtworks.map((artwork) => ({
      key: `submit:${artwork.id}`,
      kind: 'submit' as const,
      id: artwork.id,
      createdAt: artwork.createdAt
    })),
    designerCatalog.map((model) => ({
      key: `designer:${model.id}`,
      kind: 'designer' as const,
      id: model.id,
      createdAt: model.createdAt
    }))
  ), [designerCatalog, persistentArtworks]);
  const visibleDynamicEntries = useMemo(
    () => selectRotatingModels(dynamicQueue, variableModelLimit, dynamicRotationOffset),
    [dynamicQueue, dynamicRotationOffset, variableModelLimit]
  );
  const visibleSubmitIds = useMemo(() => new Set(
    visibleDynamicEntries
      .filter((entry) => entry.kind === 'submit')
      .map((entry) => entry.id)
  ), [visibleDynamicEntries]);
  const visibleDesignerModelIds = useMemo(() => visibleDynamicEntries
    .filter((entry) => entry.kind === 'designer')
    .map((entry) => entry.id), [visibleDynamicEntries]);
  const displayArtworks = useMemo(
    () => persistentArtworks.filter((artwork) => visibleSubmitIds.has(artwork.id)),
    [persistentArtworks, visibleSubmitIds]
  );
  const orderedArtworks = useMemo(
    () => [...displayArtworks].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    [displayArtworks]
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
  const latestArtworkId = persistentArtworks[persistentArtworks.length - 1]?.id ?? null;
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
  // The activity budget is strict: only admitted active IDs get a full
  // SpaceCreature update/render path. Retired entries go straight back to the
  // lightweight resting bubble atlas instead of lingering through a handoff.
  const entityIdSet = renderActiveIds;
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

  const newestDynamicModelKey = dynamicQueue[dynamicQueue.length - 1]?.key ?? null;

  useEffect(() => {
    setDynamicRotationOffset(getNewestModelWindowOffset(
      dynamicQueue.length,
      variableModelLimit
    ));
  }, [dynamicQueue.length, newestDynamicModelKey, variableModelLimit]);

  useEffect(() => {
    if (dynamicQueue.length <= variableModelLimit || variableModelLimit === 0) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setDynamicRotationOffset((current) => (
        current + DYNAMIC_MODELS_REPLACED_PER_CYCLE
      ) % dynamicQueue.length);
    }, DYNAMIC_MODEL_ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [dynamicQueue.length, variableModelLimit]);

  const handleExhibitionReady = useCallback(() => {
    setExhibitionReady(true);
  }, []);

  useEffect(() => {
    const priorityCandidates = [
      requestedCreatureId,
      pendingCreatureId,
      activeCreatureId,
      latestArtworkId
    ];
    const targetIds = prioritizeActiveModelIds(activeIds, priorityCandidates);
    const priorityIdSet = new Set(
      priorityCandidates.filter((id): id is string => Boolean(id && activeIds.has(id)))
    );
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
    const delay = priorityIdSet.has(nextId)
      ? 0
      : activeAdmissionStartedRef.current
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
  }, [
    activeCreatureId,
    activeIds,
    admittedActiveIds,
    latestArtworkId,
    pendingCreatureId,
    requestedCreatureId
  ]);

  useEffect(() => {
    replaceActiveCreatureIds(renderActiveIds);
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

  const splatShowcaseIds = useMemo(
    () => orderedArtworks.map((artwork) => artwork.id),
    [orderedArtworks]
  );
  const splatShowcaseKey = splatShowcaseIds.join('|');

  useEffect(() => {
    if (!initialAdmissionSettled || splatShowcaseIds.length === 0) return undefined;
    const requestNextShowcase = () => {
      const sketch = useSketchStore.getState();
      if (
        sketch.spotlight.creatureId
        || sketch.spotlight.requestedCreatureId
        || sketch.spotlight.pendingCreatureId
      ) return;
      const previousIndex = lastShowcasedSplatIdRef.current
        ? splatShowcaseIds.indexOf(lastShowcasedSplatIdRef.current)
        : -1;
      const nextId = splatShowcaseIds[(previousIndex + 1) % splatShowcaseIds.length];
      lastShowcasedSplatIdRef.current = nextId;
      sketch.beginSpotlight(nextId);
    };
    const initialTimeoutId = window.setTimeout(
      requestNextShowcase,
      SPLAT_SHOWCASE_INITIAL_DELAY_MS
    );
    const intervalId = window.setInterval(requestNextShowcase, SPLAT_SHOWCASE_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [initialAdmissionSettled, splatShowcaseKey]);

  useEffect(() => () => {
    setInitialCreatureAdmissionSettled(false);
  }, []);

  useEffect(() => {
    const existingIds = new Set(persistentArtworks.map((artwork) => artwork.id));
    const newIds = persistentArtworks
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
  }, [initialAdmissionSettled, persistentArtworks]);

  useEffect(() => {
    const visibleIds = new Set(displayArtworks.map((artwork) => artwork.id));
    const leavingIds = [...displayedArtworkIdsRef.current]
      .filter((id) => !visibleIds.has(id));
    displayedArtworkIdsRef.current = visibleIds;
    // A rotating work only leaves the current WebGL scene. Its backend record,
    // generation history and cached source remain intact for the next cycle.
    for (const id of leavingIds) useSketchStore.getState().cancelSpotlight(id);
  }, [displayArtworks]);

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
      <PersistentExhibitionModels
        visibleDesignerModelIds={visibleDesignerModelIds}
        onDesignerCatalogChange={setDesignerCatalog}
        onAllReady={handleExhibitionReady}
      />
      {exhibitionReady && initialAdmissionSettled ? (
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
