import type { ArtworkGaussianModelResult, ArtworkGaussianModelStatus } from '../../types/artwork';

type TripoSplatModelPayload = {
  splatUrl?: string;
  plyUrl?: string;
  previewUrl?: string;
  manifestUrl?: string;
  gaussianCount?: number;
};

type TripoSplatJobPayload = {
  jobId?: string;
  artworkId?: string;
  status?: ArtworkGaussianModelStatus;
  progress?: number;
  message?: string;
  error?: string;
  artwork?: TripoSplatModelPayload;
  model?: TripoSplatModelPayload;
};

type GenerateGaussianArtworkModelInput = {
  file: File;
  gaussianCount?: number;
  format?: 'splat' | 'ply' | 'both';
  onProgress?: (result: ArtworkGaussianModelResult) => void;
};

const DEFAULT_GAUSSIAN_COUNT = 131_072;
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 10 * 60_000;

function envBoolean(value: unknown) {
  return typeof value === 'string' && value.toLowerCase() === 'true';
}

function triposplatApiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
}

export function isTripoSplatGenerationEnabled() {
  return envBoolean(import.meta.env.VITE_TRIPOSPLAT_ENABLED) && triposplatApiBase().length > 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function absoluteAssetUrl(baseUrl: string, url?: string) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function readJson(response: Response): Promise<TripoSplatJobPayload> {
  const text = await response.text();

  try {
    return JSON.parse(text) as TripoSplatJobPayload;
  } catch {
    return { error: text || response.statusText };
  }
}

function toResult({
  baseUrl,
  jobId,
  payload,
  fallbackStatus,
  gaussianCount,
  format
}: {
  baseUrl: string;
  jobId: string;
  payload: TripoSplatJobPayload;
  fallbackStatus: ArtworkGaussianModelStatus;
  gaussianCount: number;
  format: 'splat' | 'ply' | 'both';
}): ArtworkGaussianModelResult {
  const model = payload.artwork ?? payload.model ?? {};

  return {
    jobId,
    sourceArtworkId: payload.artworkId,
    source: 'triposplat',
    status: payload.status ?? fallbackStatus,
    format,
    splatUrl: absoluteAssetUrl(baseUrl, model.splatUrl),
    plyUrl: absoluteAssetUrl(baseUrl, model.plyUrl),
    previewUrl: absoluteAssetUrl(baseUrl, model.previewUrl),
    manifestUrl: absoluteAssetUrl(baseUrl, model.manifestUrl),
    gaussianCount: model.gaussianCount ?? gaussianCount,
    progress: payload.progress,
    message: payload.message,
    createdAt: Date.now()
  };
}

export async function generateGaussianArtworkModel({
  file,
  gaussianCount = DEFAULT_GAUSSIAN_COUNT,
  format = 'both',
  onProgress
}: GenerateGaussianArtworkModelInput): Promise<ArtworkGaussianModelResult> {
  const baseUrl = triposplatApiBase();
  if (!baseUrl) {
    throw new Error('VITE_TRIPOSPLAT_API_BASE is not configured.');
  }

  const formData = new FormData();
  formData.set('image', file);
  formData.set('numGaussians', String(gaussianCount));
  formData.set('format', format);

  const createResponse = await fetch(`${baseUrl}/api/artworks`, {
    method: 'POST',
    body: formData
  });
  const created = await readJson(createResponse);

  if (!createResponse.ok || !created.jobId) {
    throw new Error(created.error ?? `TripoSplat task creation failed with ${createResponse.status}.`);
  }

  const queued = toResult({
    baseUrl,
    jobId: created.jobId,
    payload: created,
    fallbackStatus: created.status ?? 'queued',
    gaussianCount,
    format
  });
  onProgress?.(queued);

  if (queued.status === 'ready' && (queued.splatUrl || queued.plyUrl)) {
    return queued;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(created.jobId)}`);
    const polled = await readJson(pollResponse);

    if (!pollResponse.ok) {
      throw new Error(polled.error ?? `TripoSplat task polling failed with ${pollResponse.status}.`);
    }

    const result = toResult({
      baseUrl,
      jobId: created.jobId,
      payload: polled,
      fallbackStatus: 'processing',
      gaussianCount,
      format
    });
    onProgress?.(result);

    if (result.status === 'ready' && (result.splatUrl || result.plyUrl)) {
      return result;
    }

    if (result.status === 'failed') {
      throw new Error(polled.error ?? result.message ?? 'TripoSplat generation failed.');
    }
  }

  throw new Error('TripoSplat generation timed out.');
}
