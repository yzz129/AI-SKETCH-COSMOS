export type DesignerViewType =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'left_front'
  | 'right_front';

export type DesignerGenerationStatus =
  | 'queued'
  | 'submitting'
  | 'waiting'
  | 'running'
  | 'saving'
  | 'review'
  | 'publishing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type DesignerGenerationJob = {
  id: string;
  name: string;
  referenceMode: 'single' | 'multi';
  status: DesignerGenerationStatus;
  progress: number;
  message: string;
  modelId?: string | null;
  modelUrl?: string | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  elapsedSeconds: number;
  modelBytes?: number;
  views?: DesignerViewType[];
  sourceNames?: string[];
};

export type DesignerReferenceImage = {
  view: DesignerViewType;
  file: File;
};

function apiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

function removeProviderBrand(value: string) {
  return value
    .replace(/腾讯\s*混元\s*3D(?:\s*Pro)?/gi, '3D 模型')
    .replace(/混元\s*3D(?:\s*Pro)?/gi, '3D 模型')
    .replace(/腾讯\s*混元/gi, '3D 模型')
    .replace(/Tencent\s*Hunyuan(?:\s*3D)?(?:\s*Pro)?/gi, '3D 模型')
    .replace(/Hunyuan(?:\s*3D)?(?:\s*Pro)?/gi, '3D 模型')
    .replace(/混元/gi, '3D 模型');
}

function normalizeDesignerJob(job: DesignerGenerationJob) {
  return {
    ...job,
    message: removeProviderBrand(job.message),
    error: job.error ? removeProviderBrand(job.error) : job.error
  };
}

async function errorMessage(response: Response) {
  try {
    const payload = await response.json() as { detail?: string | { message?: string }; error?: string };
    if (typeof payload.detail === 'string') return payload.detail;
    if (payload.detail && typeof payload.detail === 'object' && payload.detail.message) return payload.detail.message;
    return payload.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function fetchDesignerHealth() {
  const response = await fetch(`${apiBase()}/api/designer/health`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await errorMessage(response));
  const payload = await response.json() as {
    ready: boolean;
    provider: string;
    model: string;
    output: string;
    multiView: boolean;
    confirmationRequired?: boolean;
    activeJobs: number;
    maxActiveJobs: number;
  };
  return { ...payload, provider: '3D 生成服务', model: 'PBR GLB' };
}

export async function createDesignerGeneration(name: string, references: DesignerReferenceImage[]) {
  const form = new FormData();
  form.append('name', name);
  form.append('viewTypes', JSON.stringify(references.map((item) => item.view)));
  form.append('sessionId', getDesignerSessionId());
  references.forEach((item) => form.append('images', item.file, item.file.name));
  const response = await fetch(`${apiBase()}/api/designer/generations`, {
    method: 'POST',
    body: form
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return normalizeDesignerJob(await response.json() as DesignerGenerationJob);
}

export function getDesignerSessionId() {
  const storageKey = 'designer-session-id';
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = typeof crypto.randomUUID === 'function'
      ? `designer-${crypto.randomUUID()}`
      : `designer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `designer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export async function fetchLatestDesignerGeneration() {
  const sessionId = getDesignerSessionId();
  const response = await fetch(
    `${apiBase()}/api/designer/generations/latest?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: 'no-store', credentials: 'include' }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await errorMessage(response));
  return normalizeDesignerJob(await response.json() as DesignerGenerationJob);
}

export async function fetchDesignerGeneration(jobId: string) {
  const response = await fetch(`${apiBase()}/api/designer/generations/${encodeURIComponent(jobId)}`, {
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return normalizeDesignerJob(await response.json() as DesignerGenerationJob);
}

export async function confirmDesignerGeneration(jobId: string) {
  const response = await fetch(
    `${apiBase()}/api/designer/generations/${encodeURIComponent(jobId)}/confirm`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return normalizeDesignerJob(await response.json() as DesignerGenerationJob);
}

export function resolveDesignerModelUrl(modelUrl: string) {
  if (/^https?:\/\//i.test(modelUrl)) return modelUrl;
  return new URL(modelUrl, window.location.origin).href;
}

export function designerDownloadUrl(modelUrl: string) {
  const url = new URL(resolveDesignerModelUrl(modelUrl));
  url.searchParams.set('download', '1');
  return url.href;
}

export async function fetchAdminDesignerGenerations(limit = 100) {
  const response = await fetch(`${apiBase()}/api/admin/designer-generations?limit=${limit}`, {
    cache: 'no-store',
    credentials: 'include'
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const payload = await response.json() as { jobs: DesignerGenerationJob[] };
  return { jobs: payload.jobs.map(normalizeDesignerJob) };
}

async function updateAdminDesignerGeneration(jobId: string, action: 'confirm' | 'cancel') {
  const response = await fetch(
    `${apiBase()}/api/admin/designer-generations/${encodeURIComponent(jobId)}/${action}`,
    { method: 'POST', credentials: 'include' }
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return normalizeDesignerJob(await response.json() as DesignerGenerationJob);
}

export function confirmAdminDesignerGeneration(jobId: string) {
  return updateAdminDesignerGeneration(jobId, 'confirm');
}

export function cancelAdminDesignerGeneration(jobId: string) {
  return updateAdminDesignerGeneration(jobId, 'cancel');
}
