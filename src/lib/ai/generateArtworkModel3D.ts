import type { Artwork3DModelResult, Artwork3DTaskState } from '../../types/artwork';

type GenerateArtworkModel3DInput = {
  imageDataUrl: string;
  seed?: number;
  onProgress?: (state: Artwork3DTaskState, detail?: string) => void;
};

type Artwork3DTaskPayload = {
  taskId?: string;
  state?: Artwork3DTaskState;
  modelUrl?: string | null;
  error?: string;
  detail?: unknown;
};

const POLL_INTERVAL_MS = 2_500;
const MAX_WAIT_MS = 8 * 60_000;
const CACHE_PREFIX = 'ai-sketch-hyper3d-model:';

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function proxiedModelUrl(modelUrl: string) {
  return `/api/artwork-3d/model?url=${encodeURIComponent(modelUrl)}`;
}

function hashString(input: string) {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function readCachedModel(cacheKey: string): Artwork3DModelResult | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Artwork3DModelResult;
    if (!parsed.modelUrl || !parsed.taskId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedModel(cacheKey: string, result: Artwork3DModelResult) {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch {
    // Storage may be unavailable in private mode; generation still succeeds.
  }
}

async function readJson(response: Response): Promise<Artwork3DTaskPayload> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Artwork3DTaskPayload;
  } catch {
    return { error: text || response.statusText };
  }
}

export async function generateArtworkModel3D({
  imageDataUrl,
  seed,
  onProgress
}: GenerateArtworkModel3DInput): Promise<Artwork3DModelResult> {
  const cacheKey = `${CACHE_PREFIX}${hashString(imageDataUrl)}`;
  const cached = readCachedModel(cacheKey);

  if (cached) {
    onProgress?.('succeeded', '已复用这张画的 AI 3D 模型缓存');
    return cached;
  }

  onProgress?.('queued', '正在提交 AI 3D 生成任务');

  const createResponse = await fetch('/api/artwork-3d/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, seed })
  });
  const created = await readJson(createResponse);

  if (!createResponse.ok || !created.taskId) {
    throw new Error(created.error ?? `AI 3D task creation failed with ${createResponse.status}.`);
  }

  if (created.modelUrl) {
    const result = {
      taskId: created.taskId,
      modelUrl: proxiedModelUrl(created.modelUrl),
      source: 'ark-hyper3d' as const,
      createdAt: Date.now()
    };
    writeCachedModel(cacheKey, result);
    onProgress?.('succeeded', 'AI 3D 模型已生成');
    return result;
  }

  const startedAt = Date.now();
  let state = created.state ?? 'queued';
  onProgress?.(state, `AI 3D 任务已创建：${created.taskId}`);

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`/api/artwork-3d/tasks/${encodeURIComponent(created.taskId)}`);
    const polled = await readJson(pollResponse);

    if (!pollResponse.ok) {
      throw new Error(polled.error ?? `AI 3D task polling failed with ${pollResponse.status}.`);
    }

    state = polled.state ?? 'unknown';
    onProgress?.(state, state === 'running' ? 'AI 正在塑造 3D 模型' : '正在等待 AI 3D 模型');

    if (polled.modelUrl) {
      const result = {
        taskId: created.taskId,
        modelUrl: proxiedModelUrl(polled.modelUrl),
        source: 'ark-hyper3d' as const,
        createdAt: Date.now()
      };
      writeCachedModel(cacheKey, result);
      onProgress?.('succeeded', 'AI 3D 模型已生成');
      return result;
    }

    if (state === 'failed') {
      throw new Error(polled.error ?? 'AI 3D model generation failed.');
    }
  }

  throw new Error('AI 3D model generation timed out. Please try a clearer drawing or retry later.');
}
