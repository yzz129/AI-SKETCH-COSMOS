const DB_NAME = 'cosmos-sketch-db';
const DB_VERSION = 1;
const ARTWORKS_STORE = 'artworks';
const SKETCH_CREATURES_KEY = 'cosmos-sketch-creatures';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTWORKS_STORE)) {
        db.createObjectStore(ARTWORKS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn('[cosmos-storage] IndexedDB blocked — close other tabs');
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(ARTWORKS_STORE, mode);
    const store = tx.objectStore(ARTWORKS_STORE);
    const result = fn(store);
    if (result instanceof Promise) {
      result.then(resolve).catch(reject);
    } else {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    }
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Persist artwork list to IndexedDB (large data — particles up to 30K per artwork). */
export async function persistArtworks(artworks: unknown[]): Promise<void> {
  try {
    const all = await withStore<unknown[]>('readonly', (store) => store.getAll());
    const existingIds = new Set((all || []).map((a: any) => a.id));
    const incomingIds = new Set(artworks.map((a: any) => a.id));

    // Delete removed artworks
    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        await withStore('readwrite', (s) => s.delete(id));
      }
    }

    // Put all current artworks
    for (const artwork of artworks) {
      await withStore('readwrite', (s) => s.put(artwork));
    }

    console.log(`[cosmos-storage] persisted ${artworks.length} artworks to IndexedDB`);
  } catch (err) {
    console.warn('[cosmos-storage] failed to persist artworks to IndexedDB:', err);
  }
}

/** Load artworks from IndexedDB. */
export async function loadArtworks<T>(): Promise<T[]> {
  try {
    const all = await withStore<T[]>('readonly', (store) => store.getAll());
    console.log(`[cosmos-storage] loaded ${(all || []).length} artworks from IndexedDB`);
    return (all || []) as T[];
  } catch (err) {
    console.warn('[cosmos-storage] failed to load artworks from IndexedDB:', err);
    return [];
  }
}

/** Clear all artworks from IndexedDB. */
export async function clearPersistedArtworks(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch {
    // Silently ignore clear errors
  }
}

// ── localStorage fallback for smaller sketch creatures ──

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
