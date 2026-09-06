export type DisplayExhibitionModel = {
  id: string;
  name: string;
  modelUrl: string;
  color: string;
  position: [number, number, number];
  scale: number;
  sourceFolder?: string;
  sourceImage?: string;
  referenceMode?: string;
  entryType: 'award' | 'contest';
  createdAt?: string;
};

type StaticCatalogItem = {
  id: string;
  name: string;
  modelFile: string;
  sourceFolder?: string;
  sourceImage?: string;
  referenceMode?: string;
};

const FEATURED_MODELS: StaticCatalogItem[] = [
  { id: 'civilization-seeder', name: '文明播种者', modelFile: 'civilization-seeder.glb' },
  { id: 'suiqi-new-life', name: '穗启•新生', modelFile: 'suiqi-new-life.glb' },
  { id: 'rice-cup-creative', name: '水稻杯文创', modelFile: 'rice-cup-creative.glb' }
];

const TITLE_COLORS = [
  '#f97316', '#8b5cf6', '#eab308', '#ef4444', '#3b82f6', '#ec4899',
  '#84cc16', '#f59e0b', '#a855f7', '#0ea5e9', '#f43f5e', '#65a30d'
] as const;

export async function fetchDisplayExhibitionModels(): Promise<DisplayExhibitionModel[]> {
  const staticRequest = fetch('/exhibition-models/catalog.json', { cache: 'no-store' });
  const apiBase = (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
  const dynamicRequest = apiBase
    ? fetch(`${apiBase}/api/exhibition-models`, { cache: 'no-store' }).catch(() => null)
    : Promise.resolve(null);
  const [staticResponse, dynamicResponse] = await Promise.all([staticRequest, dynamicRequest]);
  const payload = staticResponse.ok
    ? await staticResponse.json() as { items?: StaticCatalogItem[] }
    : { items: [] };
  const items = [...FEATURED_MODELS, ...(payload.items ?? [])];
  const staticModels: DisplayExhibitionModel[] = items.map((item, index) => ({
    id: item.id,
    name: item.name,
    modelUrl: `/exhibition-models/${item.modelFile}`,
    color: TITLE_COLORS[index % TITLE_COLORS.length],
    position: [0, 0, 0] as [number, number, number],
    scale: index < FEATURED_MODELS.length ? 0.46 : 0.4,
    sourceFolder: item.sourceFolder,
    sourceImage: item.sourceImage,
    referenceMode: item.referenceMode ?? 'single',
    entryType: 'award' as const
  }));
  if (!dynamicResponse?.ok) return staticModels;
  const dynamic = await dynamicResponse.json() as Array<{
    id: string;
    name: string;
    modelUrl: string;
    color: string;
    position: [number, number, number];
    scale: number;
    sourceFolder?: string;
    sourceImage?: string;
    referenceMode?: string;
    entryType?: 'award' | 'contest';
    createdAt?: string;
  }>;
  const byId = new Map(staticModels.map((model) => [model.id, model]));
  for (const record of dynamic) {
    const existingStaticModel = byId.get(record.id);
    if (existingStaticModel) {
      byId.set(record.id, {
        ...existingStaticModel,
        name: record.name || existingStaticModel.name,
        color: record.color || existingStaticModel.color,
        scale: record.scale || existingStaticModel.scale,
        sourceFolder: record.sourceFolder || existingStaticModel.sourceFolder,
        sourceImage: record.sourceImage || existingStaticModel.sourceImage,
        referenceMode: record.referenceMode ?? existingStaticModel.referenceMode,
        entryType: 'award'
      });
      continue;
    }
    const localModelMatch = record.modelUrl.match(/^\/(?:triposplat\/)?exhibition-models\/(.+\.glb(?:[?#].*)?)$/i);
    byId.set(record.id, {
      id: record.id,
      name: record.name,
      modelUrl: localModelMatch
        ? `${apiBase}/exhibition-models/${localModelMatch[1]}`
        : record.modelUrl,
      color: record.color,
      position: record.position,
      scale: record.scale,
      sourceFolder: record.sourceFolder,
      sourceImage: record.sourceImage,
      referenceMode: record.referenceMode ?? 'single',
      entryType: record.entryType === 'contest' ? 'contest' : 'award',
      createdAt: record.createdAt
    });
  }
  return [...byId.values()];
}
