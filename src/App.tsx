import { lazy, Suspense, useEffect, useState } from 'react';
import {
  hydrateCreatureEvolution,
  startCreatureEvolutionPersistence
} from './components/webgl/creatureEvolutionPersistence';
import {
  fetchAllBackendArtworks,
  fetchBackendArtworkLibraryRevision
} from './lib/artwork/backendArtworkLibrary';
import {
  hasSubmitLaunchContextParams,
  readSubmitLaunchContext
} from './lib/dadakido/submitSession';
import { type BackendArtworkRecord, useArtworkStore } from './stores/artworkStore';
import { deleteLegacyArtworkIndexedDB } from './utils/storage';

const ARTWORK_LIBRARY_CHANGED_EVENT = 'artwork-library-changed';
const ARTWORK_LIBRARY_POLL_MS = 1_000;
const INITIAL_PATHNAME = window.location.pathname.replace(/\/+$/, '') || '/';
const INITIAL_SUBMIT_LAUNCH_CONTEXT = INITIAL_PATHNAME === '/submit'
  ? readSubmitLaunchContext()
  : null;

const AdminRoute = lazy(() => import('./components/admin/AdminRoute').then((module) => ({
  default: module.AdminRoute
})));
const MobileUploadPage = lazy(() => import('./pages/MobileUploadPage').then((module) => ({
  default: module.MobileUploadPage
})));
const DesignerPage = lazy(() => import('./pages/DesignerPage').then((module) => ({
  default: module.DesignerPage
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
  const pathname = INITIAL_PATHNAME;
  const isAdminRoute = pathname === '/admin';
  const isSubmitRoute = pathname === '/submit';
  const isGuestSubmitRoute = pathname === '/guest-submit';
  const isDesignerRoute = pathname === '/designer';
  const isDisplayRoute = !isAdminRoute && !isSubmitRoute && !isGuestSubmitRoute && !isDesignerRoute;
  const [submitLaunchContext, setSubmitLaunchContext] = useState(INITIAL_SUBMIT_LAUNCH_CONTEXT);

  useEffect(() => {
    if (!isSubmitRoute) return undefined;
    const refreshSubmitLaunchContext = () => {
      if (!hasSubmitLaunchContextParams()) return;
      setSubmitLaunchContext(readSubmitLaunchContext());
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSubmitLaunchContext();
    };
    window.addEventListener('pageshow', refreshSubmitLaunchContext);
    window.addEventListener('popstate', refreshSubmitLaunchContext);
    window.addEventListener('hashchange', refreshSubmitLaunchContext);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', refreshSubmitLaunchContext);
      window.removeEventListener('popstate', refreshSubmitLaunchContext);
      window.removeEventListener('hashchange', refreshSubmitLaunchContext);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSubmitRoute]);

  useEffect(() => {
    deleteLegacyArtworkIndexedDB();
  }, []);

  useEffect(() => {
    if (!isDisplayRoute) return;
    let cancelled = false;
    let syncInFlight = false;
    let syncAgain = false;
    let forceNextSync = false;
    let pollTimer = 0;
    let lastBackendRevision: string | null = null;
    let lastSignature: string | null = null;
    let stopEvolutionPersistence: (() => void) | null = null;
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(ARTWORK_LIBRARY_CHANGED_EVENT)
      : null;

    const sync = async (forceFullSync = false) => {
      if (cancelled) return;
      if (syncInFlight) {
        syncAgain = true;
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
        // Polling only performs a network read. Zustand and React are updated
        // solely when the backend library really changed, keeping WebGL stable.
        if (nextSignature !== lastSignature) {
          useArtworkStore.getState().hydrateBackendArtworks(records);
          hydrateCreatureEvolution(records);
          lastSignature = nextSignature;
        }
        lastBackendRevision = revision.revision;
      } catch (error) {
        console.warn('[artwork-library] failed to hydrate backend artworks:', error);
      } finally {
        syncInFlight = false;
        if (syncAgain && !cancelled) {
          const shouldForce = forceNextSync;
          syncAgain = false;
          forceNextSync = false;
          queueMicrotask(() => void sync(shouldForce));
        }
      }
    };

    const requestImmediateSync = () => {
      if (!cancelled) void sync(true);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ARTWORK_LIBRARY_CHANGED_EVENT) requestImmediateSync();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) void sync();
    };
    const schedulePoll = () => {
      pollTimer = window.setTimeout(async () => {
        if (!document.hidden) await sync();
        if (!cancelled) schedulePoll();
      }, ARTWORK_LIBRARY_POLL_MS);
    };

    channel?.addEventListener('message', requestImmediateSync);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void sync().finally(() => {
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
        <AdminRoute />
      </Suspense>
    );
  }

  if (isSubmitRoute) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <MobileUploadPage
          key={submitLaunchContext?.code ?? 'missing-submit-context'}
          launchContext={submitLaunchContext}
        />
      </Suspense>
    );
  }

  if (isGuestSubmitRoute) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <MobileUploadPage launchContext={null} anonymousGuest />
      </Suspense>
    );
  }

  if (isDesignerRoute) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <DesignerPage />
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
