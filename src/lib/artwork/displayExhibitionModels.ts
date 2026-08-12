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
  const response = await fetch('/exhibition-models/catalog.json', { cache: 'no-store' });
  const payload = response.ok
    ? await response.json() as { items?: StaticCatalogItem[] }
    : { items: [] };
  const items = [...FEATURED_MODELS, ...(payload.items ?? [])];

  return items.map((item, index) => ({
    id: item.id,
    name: item.name,
    modelUrl: `/exhibition-models/${item.modelFile}`,
    color: TITLE_COLORS[index % TITLE_COLORS.length],
    position: [0, 0, 0],
    scale: index < FEATURED_MODELS.length ? 0.46 : 0.4,
    sourceFolder: item.sourceFolder,
    sourceImage: item.sourceImage,
    referenceMode: item.referenceMode ?? 'single'
  }));
}
