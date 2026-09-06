import type { ArtworkFeatureResult, ArtworkGaussianModelResult, ArtworkGaussianModelStatus } from '../../types/artwork';
import {
  CONTENT_MODERATION_REJECTED,
  CONTENT_MODERATION_UNAVAILABLE,
  moderationErrorFromPayload,
  type ArtworkModerationCategory
} from '../../utils/contentModeration';
import { toClientAssetUrl } from '../artwork/triposplatAssetUrl';

type TripoSplatModelPayload = {
  splatUrl?: string;
  plyUrl?: string;
  previewUrl?: string;
  manifestUrl?: string;
  rigUrl?: string;
  gaussianCount?: number;
};

type TripoSplatJobPayload = {
  jobId?: string;
  artworkId?: string;
  name?: string;
  submissionId?: string;
  status?: ArtworkGaussianModelStatus;
  progress?: number;
  message?: string;
  queuePosition?: number;
  estimatedWaitSeconds?: number;
  queueCapacity?: number;
  error?: string;
  detail?: string | {
    code?: string;
    message?: string;
    category?: string;
    confidence?: number;
  };
  artwork?: TripoSplatModelPayload;
  model?: TripoSplatModelPayload;
};

type GenerateGaussianArtworkModelInput = {
  file: File;
  name?: string;
  submissionId?: string;
  signal?: AbortSignal;
  gaussianCount?: number;
  format?: 'splat' | 'ply' | 'both';
  onProgress?: (result: ArtworkGaussianModelResult) => void;
  features?: ArtworkFeatureResult;
  userContext?: Record<string, unknown>;
  anonymous?: boolean;
};

export type SubmissionEligibilityResult = {
  eligible: boolean;
  testMode?: boolean;
  unidentified?: boolean;
  jobId?: string | null;
  artworkId?: string | null;
  status?: string | null;
};

const DEFAULT_GAUSSIAN_COUNT = 65_536;
const LONG_POLL_WAIT_MS = 15_000;
const LEGACY_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_RETRY_DELAY_MS = 10_000;

function maxWaitMs() {
  const configuredHours = Number.parseFloat(
    String(import.meta.env.VITE_TRIPOSPLAT_MAX_WAIT_HOURS ?? '24')
  );
  const hours = Number.isFinite(configuredHours)
    ? Math.max(0.25, Math.min(72, configuredHours))
    : 24;
  return hours * 60 * 60_000;
}

function envBoolean(value: unknown) {
  return typeof value === 'string' && value.toLowerCase() === 'true';
}

function triposplatApiBase() {
  return (import.meta.env.VITE_TRIPOSPLAT_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/triposplat';
}

export function isTripoSplatGenerationEnabled() {
  return envBoolean(import.meta.env.VITE_TRIPOSPLAT_ENABLED) && triposplatApiBase().length > 0;
}

export async function fetchSubmissionEligibility(
  userContext: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SubmissionEligibilityResult> {
  const baseUrl = triposplatApiBase();
  if (!baseUrl) return { eligible: true, unidentified: true };
  const response = await fetch(`${baseUrl}/api/submission-eligibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userContext }),
    signal
  });
  const payload = await response.json().catch(() => null) as SubmissionEligibilityResult | null;
  if (!response.ok || !payload || typeof payload.eligible !== 'boolean') {
    throw new Error(`创作资格确认失败（${response.status}）。`);
  }
  return payload;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted.', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function readJson(response: Response): Promise<TripoSplatJobPayload> {
  const text = await response.text();

  try {
    return JSON.parse(text) as TripoSplatJobPayload;
  } catch {
    return { error: text || response.statusText };
  }
}

function asModerationCategory(value: unknown): ArtworkModerationCategory | undefined {
  return value === 'safe'
    || value === 'graphic_violence'
    || value === 'sexual_explicit'
    || value === 'sexual_minors'
    ? value
    : undefined;
}

function apiError(payload: TripoSplatJobPayload, fallback: string) {
  if (payload.detail && typeof payload.detail === 'object') {
    const code = payload.detail.code;
    if (code === CONTENT_MODERATION_REJECTED || code === CONTENT_MODERATION_UNAVAILABLE) {
      return moderationErrorFromPayload({
        code,
        message: payload.detail.message,
        category: asModerationCategory(payload.detail.category),
        confidence: payload.detail.confidence
      });
    }
    if (payload.detail.message) return new Error(payload.detail.message);
  }
  if (typeof payload.detail === 'string' && payload.detail) return new Error(payload.detail);
  return new Error(payload.error ?? fallback);
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
    artworkName: payload.name,
    source: 'triposplat',
    status: payload.status ?? fallbackStatus,
    format,
    splatUrl: toClientAssetUrl(baseUrl, model.splatUrl),
    plyUrl: toClientAssetUrl(baseUrl, model.plyUrl),
    previewUrl: toClientAssetUrl(baseUrl, model.previewUrl),
    manifestUrl: toClientAssetUrl(baseUrl, model.manifestUrl),
    rigUrl: toClientAssetUrl(baseUrl, model.rigUrl),
    gaussianCount: model.gaussianCount ?? gaussianCount,
    progress: payload.progress,
    message: payload.message,
    queuePosition: payload.queuePosition,
    estimatedWaitSeconds: payload.estimatedWaitSeconds,
    queueCapacity: payload.queueCapacity,
    createdAt: Date.now()
  };
}

export async function generateGaussianArtworkModel({
  file,
  name,
  submissionId,
  signal,
  gaussianCount = DEFAULT_GAUSSIAN_COUNT,
  format = 'splat',
  onProgress,
  features,
  userContext,
  anonymous = false
}: GenerateGaussianArtworkModelInput): Promise<ArtworkGaussianModelResult> {
  const baseUrl = triposplatApiBase();
  if (!baseUrl) {
    throw new Error('3D 模型服务尚未配置。');
  }

  const formData = new FormData();
  formData.set('image', file);
  formData.set('numGaussians', String(gaussianCount));
  formData.set('format', format);
  if (name) formData.set('name', name);
  if (submissionId) formData.set('submissionId', submissionId);
  if (features) formData.set('features', JSON.stringify(features));
  if (userContext) formData.set('userContext', JSON.stringify(userContext));
  if (anonymous) formData.set('anonymous', 'true');

  const createResponse = await fetch(`${baseUrl}/api/artworks`, {
    method: 'POST',
    body: formData,
    signal
  });
  const created = await readJson(createResponse);

  if (!createResponse.ok || !created.jobId) {
    if (createResponse.status === 429) {
      throw new Error('当前上传人数较多，生成队列已满，请稍后再试。');
    }
    throw apiError(created, `3D 模型任务创建失败（${createResponse.status}）。`);
  }
  const validatesSubmissionIdentity = Boolean(
    submissionId && typeof created.submissionId === 'string'
  );
  if (validatesSubmissionIdentity && created.submissionId !== submissionId) {
    throw new Error('Submission identity mismatch.');
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
  const maximumWaitMs = maxWaitMs();
  let lastResult = queued;
  let pollFailureCount = 0;

  while (Date.now() - startedAt < maximumWaitMs) {
    const params = new URLSearchParams({
      waitMs: String(LONG_POLL_WAIT_MS),
      lastStatus: lastResult.status
    });
    if (typeof lastResult.progress === 'number') {
      params.set('lastProgress', String(lastResult.progress));
    }

    const previousResult = lastResult;
    const pollStartedAt = Date.now();
    let pollResponse: Response;
    try {
      pollResponse = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(created.jobId)}?${params}`, { signal });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
      pollFailureCount += 1;
      await sleep(Math.min(MAX_POLL_RETRY_DELAY_MS, 500 * (2 ** pollFailureCount)), signal);
      continue;
    }
    const polled = await readJson(pollResponse);

    if (!pollResponse.ok) {
      if ([429, 502, 503, 504].includes(pollResponse.status)) {
        pollFailureCount += 1;
        const retryAfterSeconds = Number.parseInt(pollResponse.headers.get('Retry-After') ?? '', 10);
        const retryDelay = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1_000
          : Math.min(MAX_POLL_RETRY_DELAY_MS, 500 * (2 ** pollFailureCount));
        await sleep(retryDelay, signal);
        continue;
      }
      throw new Error(polled.error ?? `3D 模型任务查询失败（${pollResponse.status}）。`);
    }
    pollFailureCount = 0;
    if (validatesSubmissionIdentity && polled.submissionId !== submissionId) {
      throw new Error('Submission identity mismatch.');
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
      throw new Error(polled.error ?? result.message ?? '3D 模型生成失败。');
    }

    const didNotLongPoll = Date.now() - pollStartedAt < 500
      && result.status === previousResult.status
      && result.progress === previousResult.progress;
    lastResult = result;

    if (didNotLongPoll) {
      await sleep(LEGACY_POLL_INTERVAL_MS, signal);
    }
  }

  throw new Error('3D 模型排队时间过长，请稍后在作品库查看生成结果。');
}
