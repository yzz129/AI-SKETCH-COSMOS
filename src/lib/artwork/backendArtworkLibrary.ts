import type { BackendArtworkRecord } from '../../stores/artworkStore';
import type { ArtworkFeatureResult, ArtworkGaussianModelResult } from '../../types/artwork';
import type { ProcessedArtworkImage } from '../../utils/artworkImage';
import { normalizeGaussianAssetUrlsForBackend, toClientAssetUrl } from './triposplatAssetUrl';

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
}

function normalizeRecord(baseUrl: string, record: BackendArtworkRecord): BackendArtworkRecord {
  const gaussianModel = record.gaussianModel ? {
    ...record.gaussianModel,
    splatUrl: toClientAssetUrl(baseUrl, record.gaussianModel.splatUrl),
    plyUrl: toClientAssetUrl(baseUrl, record.gaussianModel.plyUrl),
    previewUrl: toClientAssetUrl(baseUrl, record.gaussianModel.previewUrl),
    manifestUrl: toClientAssetUrl(baseUrl, record.gaussianModel.manifestUrl),
    rigUrl: toClientAssetUrl(baseUrl, record.gaussianModel.rigUrl)
  } : record.gaussianModel;

  return {
    ...record,
    sourceUrl: toClientAssetUrl(baseUrl, record.sourceUrl),
    previewUrl: toClientAssetUrl(baseUrl, record.previewUrl),
    splatUrl: toClientAssetUrl(baseUrl, record.splatUrl),
    plyUrl: toClientAssetUrl(baseUrl, record.plyUrl),
    manifestUrl: toClientAssetUrl(baseUrl, record.manifestUrl),
    gaussianModel
  };
}

export type BackendArtworkStatus = 'active' | 'deleted' | 'all';

export async function fetchBackendArtworkPage(limit = 50, offset = 0, status: BackendArtworkStatus = 'active'): Promise<{
  records: BackendArtworkRecord[];
  total: number;
}> {
  const baseUrl = apiBase();
  if (!baseUrl) return { records: [], total: 0 };

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    status
  });
  const response = await fetch(`${baseUrl}/api/artworks?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to load backend artwork library: ${response.status}`);
  }

  const records = await response.json() as BackendArtworkRecord[];
  return {
    records: records.map((record) => normalizeRecord(baseUrl, record)),
    total: Number(response.headers.get('X-Total-Count')) || records.length
  };
}

export async function fetchBackendArtworks(limit = 50): Promise<BackendArtworkRecord[]> {
  const page = await fetchBackendArtworkPage(limit, 0, 'active');
  return page.records;
}

export async function fetchAllBackendArtworks(pageSize = 200): Promise<BackendArtworkRecord[]> {
  const allRecords: BackendArtworkRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await fetchBackendArtworkPage(pageSize, offset, 'active');
    allRecords.push(...page.records);
    total = page.total;
    if (page.records.length === 0) break;
    offset += page.records.length;
  }

  return allRecords;
}

export async function updateBackendArtworkMetadata(
  artwork: ProcessedArtworkImage,
  features: ArtworkFeatureResult,
  gaussianModel?: ArtworkGaussianModelResult
) {
  const baseUrl = apiBase();
  const sourceArtworkId = gaussianModel?.sourceArtworkId;
  if (!baseUrl || !sourceArtworkId) return;

  await fetch(`${baseUrl}/api/artworks/${encodeURIComponent(sourceArtworkId)}/metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: artwork.name,
      width: artwork.width,
      height: artwork.height,
      aspect: artwork.aspect,
      features,
      gaussianModel: normalizeGaussianAssetUrlsForBackend(baseUrl, gaussianModel)
    })
  }).catch((error) => {
    console.warn('[artwork-library] failed to persist artwork metadata:', error);
  });
}

export async function patchBackendArtworkRecord(
  artworkId: string,
  payload: {
    name?: string;
    width?: number | null;
    height?: number | null;
    aspect?: number | null;
    features?: unknown;
    gaussianModel?: unknown;
  }
) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');

  const response = await fetch(`${baseUrl}/api/artworks/${encodeURIComponent(artworkId)}/metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      gaussianModel: normalizeGaussianAssetUrlsForBackend(baseUrl, payload.gaussianModel)
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to update artwork: ${response.status}`);
  }
}

export type BackendArtworkEvolutionUpdate = {
  artworkId: string;
  level: number;
  experience: number;
  victories: number;
  defeats: number;
  planetTraps: number;
  revision: number;
};

export async function patchBackendArtworkEvolution(
  records: BackendArtworkEvolutionUpdate[],
  options: { keepalive?: boolean } = {}
) {
  if (records.length === 0) return;
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');

  const response = await fetch(`${baseUrl}/api/artworks/evolution`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
    keepalive: options.keepalive
  });
  if (!response.ok) {
    throw new Error(`Failed to persist artwork evolution: ${response.status}`);
  }
}

export async function deleteBackendArtwork(artworkId: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');

  const response = await fetch(`${baseUrl}/api/artworks/${encodeURIComponent(artworkId)}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete artwork: ${response.status}`);
  }
}

export async function restoreBackendArtwork(artworkId: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');

  const response = await fetch(`${baseUrl}/api/artworks/${encodeURIComponent(artworkId)}/restore`, {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`Failed to restore artwork: ${response.status}`);
  }
}

export async function deleteBackendArtworkRecord(artworkId: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');

  const response = await fetch(`${baseUrl}/api/artworks/${encodeURIComponent(artworkId)}/permanent`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete artwork record: ${response.status}`);
  }
}
