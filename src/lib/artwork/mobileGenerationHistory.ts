import type { StoredArtwork } from '../../stores/artworkStore';

export type MobileGenerationHistoryEntry = {
  artworkId: string;
  name: string;
  thumbnailUrl: string;
  createdAt: number;
};

type MobileGenerationHistoryPayload = {
  version: 1;
  entries: MobileGenerationHistoryEntry[];
};

const STORAGE_KEY = 'ai-sketch-cosmos:mobile-generation-history';
const ANONYMOUS_LAST_ARTWORK_STORAGE_KEY = 'ai-sketch-cosmos:anonymous-last-artwork';
const MAX_HISTORY_ENTRIES = 24;

type AnonymousLastArtworkPayload = {
  version: 1;
  artworkId: string;
};

function writeMobileGenerationHistory(entries: MobileGenerationHistoryEntry[]) {
  try {
    const payload: MobileGenerationHistoryPayload = { version: 1, entries };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Keep returning the in-memory list when private mode blocks localStorage.
  }
}

function isHistoryEntry(value: unknown): value is MobileGenerationHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.artworkId === 'string'
    && typeof entry.name === 'string'
    && typeof entry.thumbnailUrl === 'string'
    && typeof entry.createdAt === 'number'
    && Number.isFinite(entry.createdAt);
}

export function readMobileGenerationHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as Partial<MobileGenerationHistoryPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.entries)) return [];
    return payload.entries.filter(isHistoryEntry).slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function rememberMobileGeneration(artwork: StoredArtwork) {
  const artworkId = artwork.gaussianModel?.sourceArtworkId;
  if (!artworkId) return readMobileGenerationHistory();

  const entry: MobileGenerationHistoryEntry = {
    artworkId,
    name: artwork.name || '我的星河生命',
    thumbnailUrl: artwork.gaussianModel?.previewUrl ?? '',
    createdAt: artwork.createdAt || Date.now()
  };
  const entries = [
    entry,
    ...readMobileGenerationHistory().filter((item) => item.artworkId !== artworkId)
  ].slice(0, MAX_HISTORY_ENTRIES);

  writeMobileGenerationHistory(entries);
  return entries;
}

export function readAnonymousLastArtworkId() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ANONYMOUS_LAST_ARTWORK_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as Partial<AnonymousLastArtworkPayload>;
    return payload.version === 1 && typeof payload.artworkId === 'string' && payload.artworkId.trim()
      ? payload.artworkId.trim()
      : null;
  } catch {
    return null;
  }
}

export function rememberAnonymousLastArtwork(artwork: StoredArtwork) {
  const artworkId = artwork.gaussianModel?.sourceArtworkId?.trim();
  if (!artworkId) return null;
  try {
    const payload: AnonymousLastArtworkPayload = { version: 1, artworkId };
    window.localStorage.setItem(ANONYMOUS_LAST_ARTWORK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The completed result remains visible in the current session when storage is unavailable.
  }
  return artworkId;
}

export function clearAnonymousLastArtwork() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ANONYMOUS_LAST_ARTWORK_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions; the caller can still continue in memory.
  }
}

export function syncMobileGenerationHistoryNames(namesByArtworkId: ReadonlyMap<string, string>) {
  const entries = readMobileGenerationHistory().map((entry) => {
    const name = namesByArtworkId.get(entry.artworkId)?.trim();
    return name && name !== entry.name ? { ...entry, name } : entry;
  });
  writeMobileGenerationHistory(entries);
  return entries;
}
