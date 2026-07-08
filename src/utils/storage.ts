const LEGACY_ARTWORK_DB_NAME = 'cosmos-sketch-db';
const SKETCH_CREATURES_KEY = 'cosmos-sketch-creatures';
let legacyArtworkDeleteRequested = false;

export function deleteLegacyArtworkIndexedDB(): void {
  if (typeof indexedDB === 'undefined') return;
  if (legacyArtworkDeleteRequested) return;
  legacyArtworkDeleteRequested = true;

  try {
    const request = indexedDB.deleteDatabase(LEGACY_ARTWORK_DB_NAME);
    request.onsuccess = () => {
      if ((request.result as IDBDatabase | undefined)?.objectStoreNames.length) {
        console.log('[cosmos-storage] deleted legacy artwork IndexedDB');
      }
    };
    request.onerror = () => console.warn('[cosmos-storage] failed to delete legacy artwork IndexedDB:', request.error);
    request.onblocked = () => console.warn('[cosmos-storage] legacy IndexedDB delete blocked; close other tabs');
  } catch (err) {
    console.warn('[cosmos-storage] failed to request legacy IndexedDB deletion:', err);
  }
}

export function persistSketchCreatures<T>(creatures: T[]): void {
  try {
    if (creatures.length === 0) {
      localStorage.removeItem(SKETCH_CREATURES_KEY);
    } else {
      localStorage.setItem(SKETCH_CREATURES_KEY, JSON.stringify(creatures));
    }
    console.log(`[cosmos-storage] persisted ${creatures.length} sketch creatures to localStorage`);
  } catch (err) {
    console.warn('[cosmos-storage] failed to persist sketch creatures:', err);
  }
}

export function loadSketchCreatures<T>(): T[] {
  try {
    const raw = localStorage.getItem(SKETCH_CREATURES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch (err) {
    console.warn('[cosmos-storage] failed to load sketch creatures:', err);
    return [];
  }
}
