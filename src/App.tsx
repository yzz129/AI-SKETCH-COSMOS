import { useEffect } from 'react';
import { ArtworkAdminPage } from './components/admin/ArtworkAdminPage';
import {
  hydrateCreatureEvolution,
  startCreatureEvolutionPersistence
} from './components/webgl/creatureEvolutionPersistence';
import { WebGLCanvas } from './components/webgl/WebGLCanvas';
import { fetchAllBackendArtworks } from './lib/artwork/backendArtworkLibrary';
import { useArtworkStore } from './stores/artworkStore';
import { deleteLegacyArtworkIndexedDB } from './utils/storage';

const ARTWORK_LIBRARY_CHANGED_EVENT = 'artwork-library-changed';

async function syncBackendArtworkLibrary() {
  try {
    const records = await fetchAllBackendArtworks();
    useArtworkStore.getState().hydrateBackendArtworks(records);
    hydrateCreatureEvolution(records);
  } catch (error) {
    console.warn('[artwork-library] failed to hydrate backend artworks:', error);
  }
}

export default function App() {
  const isAdminRoute = window.location.pathname === '/admin';

  useEffect(() => {
    deleteLegacyArtworkIndexedDB();
  }, []);

  useEffect(() => {
    if (isAdminRoute) return;
    let cancelled = false;
    let stopEvolutionPersistence: (() => void) | null = null;
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(ARTWORK_LIBRARY_CHANGED_EVENT)
      : null;

    const sync = () => {
      if (!cancelled) void syncBackendArtworkLibrary();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ARTWORK_LIBRARY_CHANGED_EVENT) sync();
    };

    channel?.addEventListener('message', sync);
    window.addEventListener('storage', handleStorage);

    void syncBackendArtworkLibrary().finally(() => {
      if (!cancelled) stopEvolutionPersistence = startCreatureEvolutionPersistence();
    });

    return () => {
      cancelled = true;
      channel?.removeEventListener('message', sync);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
      stopEvolutionPersistence?.();
    };
  }, [isAdminRoute]);

  if (isAdminRoute) {
    return <ArtworkAdminPage />;
  }

  return (
    <main className="display-shell" aria-label="星河画境">
      <WebGLCanvas />
    </main>
  );
}
