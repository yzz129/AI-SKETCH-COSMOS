import { useEffect } from 'react';
import { ArtworkAdminPage } from './components/admin/ArtworkAdminPage';
import { WebGLCanvas } from './components/webgl/WebGLCanvas';
import { fetchAllBackendArtworks } from './lib/artwork/backendArtworkLibrary';
import { useArtworkStore } from './stores/artworkStore';
import { deleteLegacyArtworkIndexedDB } from './utils/storage';

export default function App() {
  const isAdminRoute = window.location.pathname === '/admin';

  useEffect(() => {
    deleteLegacyArtworkIndexedDB();
  }, []);

  useEffect(() => {
    if (isAdminRoute) return;
    let cancelled = false;

    fetchAllBackendArtworks()
      .then((records) => {
        if (!cancelled && records.length) {
          useArtworkStore.getState().hydrateBackendArtworks(records);
        }
      })
      .catch((error) => {
        console.warn('[artwork-library] failed to hydrate backend artworks:', error);
      });

    return () => {
      cancelled = true;
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
