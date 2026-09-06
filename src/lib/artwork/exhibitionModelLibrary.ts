import { toClientAssetUrl } from './triposplatAssetUrl';

export type ExhibitionModelRecord = {
  id: string;
  name: string;
  modelUrl: string;
  previewUrl?: string | null;
  color: string;
  position: [number, number, number];
  scale: number;
  sourceFolder?: string | null;
  sourceImage?: string | null;
  referenceMode: string;
  entryType: 'award' | 'contest';
  alwaysFloating: boolean;
  participatesInLevel: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

function toBackendModelUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('/triposplat/exhibition-models/')) {
    return trimmed.slice('/triposplat'.length);
  }
  return trimmed;
}

function toClientExhibitionModelUrl(baseUrl: string, value: string) {
  const trimmed = value.trim();
  // Built-in exhibition models are part of the frontend build. Serving them
  // from the same origin avoids routing 9–17 MB files through the API tunnel,
  // which can time out while the HTML shell itself still appears healthy.
  const localMatch = trimmed.match(/^\/(?:triposplat\/)?exhibition-models\/(.+\.glb(?:[?#].*)?)$/i);
  if (localMatch) return `/exhibition-models/${localMatch[1]}`;
  return toClientAssetUrl(baseUrl, trimmed) || trimmed;
}

type StaticCatalogItem = {
  id: string;
  name: string;
  modelFile: string;
  sourceFolder?: string;
  sourceImage?: string;
  referenceMode?: string;
};

const FEATURED_FALLBACK_MODELS: StaticCatalogItem[] = [
  { id: 'civilization-seeder', name: '文明播种者', modelFile: 'civilization-seeder.glb' },
  { id: 'suiqi-new-life', name: '穗启•新生', modelFile: 'suiqi-new-life.glb' },
  { id: 'rice-cup-creative', name: '水稻杯文创', modelFile: 'rice-cup-creative.glb' }
];

const FALLBACK_TITLE_COLORS = [
  '#f97316', '#8b5cf6', '#eab308', '#ef4444', '#3b82f6', '#ec4899',
  '#84cc16', '#f59e0b', '#a855f7', '#0ea5e9', '#f43f5e', '#65a30d'
] as const;

async function fetchStaticExhibitionModels(): Promise<ExhibitionModelRecord[]> {
  const response = await fetch('/exhibition-models/catalog.json', { cache: 'no-store' });
  if (!response.ok) return [];
  const payload = await response.json() as { items?: StaticCatalogItem[] };
  const items = [...FEATURED_FALLBACK_MODELS, ...(payload.items ?? [])];
  const createdAt = new Date(0).toISOString();
  return items.map((item, index) => ({
    id: item.id,
    name: item.name,
    modelUrl: `/exhibition-models/${item.modelFile}`,
    previewUrl: null,
    color: FALLBACK_TITLE_COLORS[index % FALLBACK_TITLE_COLORS.length],
    position: [0, 0, 0],
    scale: index < 3 ? 0.46 : 0.4,
    sourceFolder: item.sourceFolder ?? null,
    sourceImage: item.sourceImage ?? null,
    referenceMode: item.referenceMode ?? 'single',
    entryType: 'award',
    alwaysFloating: true,
    participatesInLevel: false,
    isDeleted: false,
    createdAt,
    updatedAt: createdAt
  }));
}

export async function fetchExhibitionModels(options: { includeDeleted?: boolean } = {}): Promise<ExhibitionModelRecord[]> {
  const baseUrl = apiBase();
  if (!baseUrl) return fetchStaticExhibitionModels();
  const query = options.includeDeleted ? '?includeDeleted=true' : '';
  const response = await fetch(`${baseUrl}/api/exhibition-models${query}`, { cache: 'no-store' });
  if (!response.ok) {
    if (!options.includeDeleted && response.status === 404) return fetchStaticExhibitionModels();
    throw new Error(`Failed to load exhibition models: ${response.status}`);
  }
  const records = await response.json() as ExhibitionModelRecord[];
  return records.map((record) => ({
    ...record,
    entryType: record.entryType === 'contest' ? 'contest' : 'award',
    modelUrl: toClientExhibitionModelUrl(baseUrl, record.modelUrl),
    previewUrl: toClientAssetUrl(baseUrl, record.previewUrl)
  }));
}

export async function createExhibitionModel(payload: {
  id: string;
  name: string;
  modelUrl: string;
  previewUrl?: string | null;
  color?: string;
  position?: [number, number, number];
  scale?: number;
  sourceFolder?: string | null;
  sourceImage?: string | null;
  referenceMode?: string;
  entryType?: 'award' | 'contest';
}) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${baseUrl}/api/exhibition-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...payload, modelUrl: toBackendModelUrl(payload.modelUrl) })
  });
  if (!response.ok) throw new Error(`Failed to create exhibition model: ${response.status}`);
  return await response.json() as ExhibitionModelRecord;
}

export async function updateExhibitionModel(id: string, payload: Partial<ExhibitionModelRecord>) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${baseUrl}/api/exhibition-models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...payload,
      ...(typeof payload.modelUrl === 'string' ? { modelUrl: toBackendModelUrl(payload.modelUrl) } : {})
    })
  });
  if (!response.ok) throw new Error(`Failed to update exhibition model: ${response.status}`);
  return await response.json() as ExhibitionModelRecord;
}

export async function deleteExhibitionModel(id: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${baseUrl}/api/exhibition-models/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to delete exhibition model: ${response.status}`);
}

export async function restoreExhibitionModel(id: string) {
  const baseUrl = apiBase();
  if (!baseUrl) throw new Error('作品后台尚未配置。');
  const response = await fetch(`${baseUrl}/api/exhibition-models/${encodeURIComponent(id)}/restore`, { method: 'POST', credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to restore exhibition model: ${response.status}`);
}
