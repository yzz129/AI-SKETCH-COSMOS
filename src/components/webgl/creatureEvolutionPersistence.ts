import type { BackendArtworkRecord } from '../../stores/artworkStore';
import { useArtworkStore } from '../../stores/artworkStore';
import {
  patchBackendArtworkEvolution,
  type BackendArtworkEvolutionUpdate
} from '../../lib/artwork/backendArtworkLibrary';
import { useCreatureEvolutionStore } from './creatureEvolutionStore';

const EVOLUTION_SYNC_INTERVAL_MS = 1_200;
const persistedRevisions = new Map<string, number>();

export function hydrateCreatureEvolution(records: BackendArtworkRecord[]) {
  const entries = records.flatMap((record, index) => {
    if (!record.evolution) return [];
    persistedRevisions.set(record.id, record.evolution.revision);
    return [{ id: record.id, index, evolution: record.evolution }];
  });
  useCreatureEvolutionStore.getState().hydrateCreatures(entries);
}

export function startCreatureEvolutionPersistence() {
  const pending = new Map<string, BackendArtworkEvolutionUpdate>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  const schedule = () => {
    if (timer || flushing || pending.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void flush(false);
    }, EVOLUTION_SYNC_INTERVAL_MS);
  };

  const flush = async (keepalive: boolean) => {
    if (flushing || pending.size === 0) return;
    flushing = true;
    const batch = Array.from(pending.values());
    pending.clear();
    try {
      await patchBackendArtworkEvolution(batch, { keepalive });
      for (const record of batch) {
        persistedRevisions.set(
          record.artworkId,
          Math.max(persistedRevisions.get(record.artworkId) ?? -1, record.revision)
        );
      }
    } catch (error) {
      for (const record of batch) {
        const queued = pending.get(record.artworkId);
        if (!queued || queued.revision < record.revision) pending.set(record.artworkId, record);
      }
      console.warn('[creature-evolution] failed to persist evolution state:', error);
    } finally {
      flushing = false;
      schedule();
    }
  };

  const capture = () => {
    const artworks = useArtworkStore.getState().artworks;
    const backendIdByCreatureId = new Map(artworks.map((artwork) => [
      artwork.id,
      artwork.gaussianModel?.sourceArtworkId ?? artwork.id
    ]));
    const records = useCreatureEvolutionStore.getState().records;
    for (const [creatureId, record] of Object.entries(records)) {
      const artworkId = backendIdByCreatureId.get(creatureId);
      if (!artworkId || record.revision <= (persistedRevisions.get(artworkId) ?? -1)) continue;
      const queued = pending.get(artworkId);
      if (queued && queued.revision >= record.revision) continue;
      pending.set(artworkId, {
        artworkId,
        level: record.level,
        experience: record.experience,
        victories: record.victories,
        defeats: record.defeats,
        planetTraps: record.planetTraps,
        revision: record.revision
      });
    }
    schedule();
  };

  let previousRecords = useCreatureEvolutionStore.getState().records;
  const unsubscribe = useCreatureEvolutionStore.subscribe((state) => {
    if (state.records === previousRecords) return;
    previousRecords = state.records;
    capture();
  });
  const handlePageHide = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    capture();
    void flush(true);
  };
  window.addEventListener('pagehide', handlePageHide);
  capture();

  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', handlePageHide);
    if (timer) clearTimeout(timer);
    capture();
    void flush(true);
  };
}
