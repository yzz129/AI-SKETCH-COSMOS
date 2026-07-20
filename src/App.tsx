import { lazy, Suspense, useEffect } from 'react';
import {
  hydrateCreatureEvolution,
  startCreatureEvolutionPersistence
} from './components/webgl/creatureEvolutionPersistence';
import {
  fetchAllBackendArtworks,
  fetchBackendArtworkLibraryRevision
} from './lib/artwork/backendArtworkLibrary';
import { type BackendArtworkRecord, useArtworkStore } from './stores/artworkStore';
import { useSketchStore } from './stores/useSketchStore';
import { deleteLegacyArtworkIndexedDB } from './utils/storage';

const ARTWORK_LIBRARY_CHANGED_EVENT = 'artwork-library-changed';
const ARTWORK_LIBRARY_POLL_MS = 2_500;

const ArtworkAdminPage = lazy(() => import('./components/admin/ArtworkAdminPage').then((module) => ({
  default: module.ArtworkAdminPage
})));
const MobileUploadPage = lazy(() => import('./pages/MobileUploadPage').then((module) => ({
  default: module.MobileUploadPage
})));
const WebGLCanvas = lazy(() => import('./components/webgl/WebGLCanvas').then((module) => ({
  default: module.WebGLCanvas
})));

function backendLibrarySignature(records: BackendArtworkRecord[]) {
  return records.map((record) => [
    record.id,
    record.updatedAt ?? '',
    record.deletedAt ?? '',
    record.splatUrl ?? '',
    record.plyUrl ?? '',
    record.manifestUrl ?? '',
    record.gaussianModel?.splatUrl ?? '',
    record.gaussianModel?.plyUrl ?? '',
    record.gaussianModel?.rigUrl ?? '',
    record.gaussianModel?.status ?? '',
    record.evolution?.revision ?? 0
  ].join('\u001f')).join('\u001e');
}

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      正在连接星河…
    </div>
  );
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const isAdminRoute = pathname === '/admin';
  const isSubmitRoute = pathname === '/submit';
  const isDisplayRoute = !isAdminRoute && !isSubmitRoute;

  useEffect(() => {
    deleteLegacyArtworkIndexedDB();
  }, []);

  useEffect(() => {
    if (!isDisplayRoute) return;
    let cancelled = false;
    let syncInFlight = false;
    let syncAgain = false;
    let spotlightOnNextSync = false;
    let forceNextSync = false;
    let pollTimer = 0;
    let lastBackendRevision: string | null = null;
    let lastSignature: string | null = null;
    let knownBackendIds: Set<string> | null = null;
    let stopEvolutionPersistence: (() => void) | null = null;
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(ARTWORK_LIBRARY_CHANGED_EVENT)
      : null;

    const sync = async (spotlightNewArtwork: boolean, forceFullSync = false) => {
      if (cancelled) return;
      if (syncInFlight) {
        syncAgain = true;
        spotlightOnNextSync ||= spotlightNewArtwork;
        forceNextSync ||= forceFullSync;
        return;
      }

      syncInFlight = true;
      try {
        const revision = await fetchBackendArtworkLibraryRevision();
        if (!forceFullSync && revision.revision === lastBackendRevision) return;

        const records = await fetchAllBackendArtworks();
        if (cancelled) return;

        const nextSignature = backendLibrarySignature(records);
        const newRecord = knownBackendIds
          ? records.find((record) => !knownBackendIds?.has(record.id))
          : undefined;

        // Polling only performs a network read. Zustand and React are updated
        // solely when the backend library really changed, keeping WebGL stable.
        if (nextSignature !== lastSignature) {
          useArtworkStore.getState().hydrateBackendArtworks(records);
          hydrateCreatureEvolution(records);
          lastSignature = nextSignature;
        }
        lastBackendRevision = revision.revision;
        knownBackendIds = new Set(records.map((record) => record.id));

        if (spotlightNewArtwork && newRecord) {
          const artwork = useArtworkStore.getState().artworks.find((candidate) => (
            candidate.id === newRecord.id
            || candidate.gaussianModel?.sourceArtworkId === newRecord.id
          ));
          if (artwork) useSketchStore.getState().beginSpotlight(artwork.id);
        }
      } catch (error) {
        console.warn('[artwork-library] failed to hydrate backend artworks:', error);
      } finally {
        syncInFlight = false;
        if (syncAgain && !cancelled) {
          const shouldSpotlight = spotlightOnNextSync;
          const shouldForce = forceNextSync;
          syncAgain = false;
          spotlightOnNextSync = false;
          forceNextSync = false;
          queueMicrotask(() => void sync(shouldSpotlight, shouldForce));
        }
      }
    };

    const requestImmediateSync = () => {
      if (!cancelled) void sync(true, true);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ARTWORK_LIBRARY_CHANGED_EVENT) requestImmediateSync();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) void sync(true);
    };
    const schedulePoll = () => {
      pollTimer = window.setTimeout(async () => {
        if (!document.hidden) await sync(true);
        if (!cancelled) schedulePoll();
      }, ARTWORK_LIBRARY_POLL_MS);
    };

    channel?.addEventListener('message', requestImmediateSync);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void sync(false).finally(() => {
      if (cancelled) return;
      stopEvolutionPersistence = startCreatureEvolutionPersistence();
      schedulePoll();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
      channel?.removeEventListener('message', requestImmediateSync);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopEvolutionPersistence?.();
    };
  }, [isDisplayRoute]);

  if (isAdminRoute) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <ArtworkAdminPage />
      </Suspense>
    );
  }

  if (isSubmitRoute) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <MobileUploadPage />
      </Suspense>
    );
  }

  return (
    <main className="display-shell" aria-label="星河画境">
      <Suspense fallback={<RouteLoading />}>
        <WebGLCanvas />
      </Suspense>
    </main>
  );
}
