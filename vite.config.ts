import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ARK_RESPONSES_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
const ARK_CONTENT_TASKS_URL = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const ARK_MODEL = 'doubao-seed-2-0-mini-260428';
const ARK_3D_MODEL = 'hyper3d-gen2-260112';
const ARK_3D_MAX_SEED = 65535;
const DEFAULT_TRIPOSPLAT_API_TARGET = 'http://127.0.0.1:8000';
const DEFAULT_DADAKIDO_API_TARGET = 'http://192.168.1.247:3000';
const DEFAULT_DADAKIDO_CHECKIN_API_TARGET = 'http://192.168.1.247:3000';

function createTripoSplatProxy(target: string) {
  return {
    '/triposplat': {
      target,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/triposplat/, '')
    }
  };
}

function createDevProxy(
  triposplatTarget: string,
  dadakidoTarget: string,
  dadakidoCheckInTarget: string
) {
  return {
    ...createTripoSplatProxy(triposplatTarget),
    '/dadakido-api': {
      target: dadakidoTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/dadakido-api/, '')
    },
    '/dadakido-checkin-api': {
      target: dadakidoCheckInTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/dadakido-checkin-api/, '')
    }
  };
}

function readRequestBody(request: import('node:http').IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    // Vite's internal middleware may have already consumed & parsed the body
    const preParsed = (request as any).body;
    if (preParsed !== undefined) {
      resolve(typeof preParsed === 'string' ? preParsed : JSON.stringify(preParsed));
      return;
    }

    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function parseRequestBody(request: import('node:http').IncomingMessage) {
  const raw = await readRequestBody(request);
  if (!raw || raw.trim().length === 0) {
    console.warn('[vite-plugin] Request body is empty — upstream middleware may have consumed it');
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn('[vite-plugin] Failed to parse request body as JSON, raw length:', raw.length);
    return null;
  }
}

function extractTextFromArkResponse(payload: unknown): string {
  const texts: string[] = [];

  const walk = (value: unknown) => {
    if (!value) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if ((record.type === 'output_text' || record.type === 'text') && typeof record.text === 'string') {
      texts.push(record.text);
    }
    if (typeof record.output_text === 'string') texts.push(record.output_text);
    Object.values(record).forEach(walk);
  };

  walk(payload);
  return texts.join('\n').trim();
}

function parseJsonFromModelText(text: string) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('AI response did not contain JSON.');
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function writeJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  payload: unknown
) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

function extractFirstStringByKeys(payload: unknown, keys: string[]) {
  const keySet = new Set(keys);
  let match: string | null = null;

  const walk = (value: unknown) => {
    if (match || !value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, entry]) => {
      if (match) return;
      if (keySet.has(key) && typeof entry === 'string') {
        match = entry;
        return;
      }
      walk(entry);
    });
  };

  walk(payload);
  return match;
}

function extractGeneratedModelUrl(payload: unknown) {
  const urls: string[] = [];
  const candidateUrls: string[] = [];

  const walk = (value: unknown, keyHint = '') => {
    if (!value) return;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && /\.(glb|gltf|zip)(\?|#|$)/i.test(value)) {
        urls.push(value);
      } else if (
        /^https?:\/\//i.test(value)
        && /(model|mesh|asset|result|output|file|content|url)/i.test(keyHint)
        && !/\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(value)
      ) {
        candidateUrls.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, keyHint));
      return;
    }
    if (typeof value !== 'object') return;
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => walk(entry, key));
  };

  walk(payload);
  return urls.find((url) => /\.glb(\?|#|$)/i.test(url))
    ?? urls.find((url) => /\.gltf(\?|#|$)/i.test(url))
    ?? urls[0]
    ?? candidateUrls[0]
    ?? null;
}

function normalizeTaskState(payload: unknown) {
  const raw = extractFirstStringByKeys(payload, ['status', 'state', 'task_status', 'taskStatus'])?.toLowerCase();

  if (!raw) return 'unknown';
  if (['queued', 'pending', 'created', 'waiting'].includes(raw)) return 'queued';
  if (['running', 'processing', 'in_progress', 'generating'].includes(raw)) return 'running';
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(raw)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled', 'timeout'].includes(raw)) return 'failed';
  return 'unknown';
}

function createHyper3DPrompt() {
  return `Generate a textured GLB-style 3D model from this children's drawing.
Faithfully preserve the drawing's silhouette, proportions, colors, and hand-painted texture.
Make it a complete rounded 3D creature/object viewable from front, side, and back, not a flat cardboard cutout.
Style: soft, dreamy, child-friendly, slightly magical, suitable for a cosmic starfield scene.
Avoid realistic adult concept art. Keep the original drawing identity.`;
}

function normalizeHyper3DSeed(seed: unknown) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.max(0, Math.min(ARK_3D_MAX_SEED, Math.floor(seed)));
  }

  return Math.floor(Math.random() * (ARK_3D_MAX_SEED + 1));
}

function createArtworkFeaturePrompt() {
  return `你是儿童画行为与结构特征识别助手。
请分析上传图片中的主体。不要只输出具体物种名称，也不要根据文件名猜测；只根据图像内容判断结构特征、行为倾向和视觉气质。

重点识别：
- 主体类别：animal / plant / character / abstract / object
- 是否有翅膀，翅膀数量
- 是否有鱼鳍
- 是否有腿，腿的数量
- 是否有手臂
- 是否有尾巴
- 是否有头部
- 身体方向：horizontal / vertical / floating / undefined
- 适合飞行、奔跑、跳跃、游动、漂浮、爬行、摇摆、生长还是静止发光
- 画面主色、亮度、柔软程度、手绘材质风格
- 气质：cute / dreamy / playful / gentle / mysterious
- 适合做局部运动的身体部位 motionParts：从 head、ears、leftArm、rightArm、arms、leftLeg、rightLeg、legs、tail、wings、fins、body 中选择 1 到 6 个。优先选择图中真实存在且适合整体摆动/点头/抬腿/摆尾的部位。

请严格输出 JSON，不要 Markdown，不要解释，不要额外字段。下面 JSON 中的值只是类型示例，请必须根据图像内容改写每一个值。格式必须完全符合：
{
  "subjectCategory": "animal | plant | character | abstract | object",
  "morphology": {
    "hasWings": true,
    "wingCount": 0,
    "hasLegs": true,
    "legCount": 0,
    "hasTail": true,
    "hasFins": true,
    "hasArms": true,
    "hasHead": true,
    "bodyOrientation": "horizontal | vertical | floating | undefined",
    "silhouetteComplexity": "simple | medium | complex"
  },
  "behaviorTraits": {
    "locomotionType": "flying | running | hopping | walking | swimming | floating | crawling | swaying | growing | idle",
    "energyLevel": "calm | gentle | active",
    "personalityFeel": "cute | dreamy | playful | gentle | mysterious"
  },
  "visualTraits": {
    "dominantColors": ["#64D9FF", "#FFD166"],
    "brightness": "low | medium | high",
    "softness": "soft | normal | sharp",
    "textureStyle": "handdrawn | watercolor | crayon | flat | mixed"
  },
  "motionParts": ["head", "leftArm", "rightArm", "tail"]
}

约束：
- wingCount 只能是 0、1、2、4。
- legCount 只能是 0、2、4、6、8。
- 如果画面主体不清晰，subjectCategory 使用 abstract，locomotionType 使用 floating 或 idle。
- 不要输出 motionPreset，前端会自行映射。
- dominantColors 必须是十六进制颜色字符串数组。
- motionParts 不要包含图中不存在的部位；如果不能判断，就输出 ["body"]。`;
}

function createLegacyRecognitionPrompt() {
  return `你是儿童画星空展示系统的视觉识别模块。请只识别画作的行为特征和形态特征，不要判断、输出或猜测具体生物名称。
请基于图片返回严格 JSON，不要 Markdown，不要解释。字段必须完整：
{
  "version": "cosmic-creature-v1",
  "source": "ark",
  "summary": "一句中文总结，描述形态和行为倾向，不出现具体生物名称",
  "form": {
    "silhouette": "中文短语，描述轮廓，例如细长、圆润、开放、分叉、柔软、尖锐",
    "symmetry": "left-right | radial | asymmetric | unclear",
    "elongation": 0,
    "roundness": 0,
    "openness": 0,
    "appendageDensity": 0,
    "edgeComplexity": 0
  },
  "behavior": {
    "locomotion": ["中文行为词，例如漂浮、滑行、摆动、跳跃、盘旋、闪烁"],
    "tempo": "slow | medium | fast | mixed",
    "energy": 0,
    "buoyancy": 0,
    "fluidity": 0,
    "curiosity": 0,
    "caution": 0
  },
  "visual": {
    "glow": 0,
    "edgeGlow": 0,
    "trailLength": 0,
    "particleSpread": 0,
    "depth": 0
  },
  "motionType": "fly | hop | swim | run | walk | float",
  "actionTypes": ["glide","hover","drift","orbit","spiral","flutter","swim","dart","pulse","breathe","bob","hop","tumble","loop","sweep","wiggle","shimmer","bloom","stretch","trail","approach","retreat"]
}

actionTypes 请选择 3 到 5 个，必须来自上面列表。优先描述动作和形态，不要出现具体动物、植物、人物或物种名称。`;
}

type ModerationCategory = 'safe' | 'graphic_violence' | 'sexual_explicit' | 'sexual_minors';

function createContentModerationPrompt() {
  return `你是画作上传的内容安全审核器。只识别下列高风险类别，并只输出一个 JSON 对象：
{
  "decision": "allow" | "block",
  "category": "safe" | "graphic_violence" | "sexual_explicit" | "sexual_minors",
  "confidence": 0.0,
  "reason": "一句简短中文理由"
}

仅在画面有明确证据时拦截：
1. graphic_violence：清晰可见的大量流血、开放性创伤、器官、肢解、断头、严重尸体损伤或以虐杀为主体的血腥场景。
2. sexual_explicit：清晰可见的性行为、性器官特写、色情展示或明显为性刺激而呈现的裸露。
3. sexual_minors：任何涉及未成年人的性化、裸露或性行为内容。

为减少误判，以下应 allow：普通泳装、无性暗示的日常露肤、医学/艺术人体但无露骨性展示、红色颜料/番茄酱、奇幻战斗、持有武器、轻微擦伤、威胁或打斗但没有上述明显血腥伤害。
不要因为题材、颜色或模糊联想拦截。不确定时 decision=allow，confidence 应低于 0.82。`;
}

function moderationMessage(category: ModerationCategory) {
  if (category === 'graphic_violence') {
    return '检测到图片含有明显血腥或严重暴力内容，请重新上传健康、非血腥的作品。';
  }
  if (category === 'sexual_explicit' || category === 'sexual_minors') {
    return '检测到图片含有色情或不适宜内容，请重新上传合适的作品。';
  }
  return '这张图片未通过内容安全检测，请重新上传其他作品。';
}

function normalizeModerationResult(parsed: unknown, configuredThreshold?: string) {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const validCategories = new Set<ModerationCategory>([
    'safe',
    'graphic_violence',
    'sexual_explicit',
    'sexual_minors'
  ]);
  const rawCategory = typeof record.category === 'string' ? record.category.trim().toLowerCase() : 'safe';
  const category = validCategories.has(rawCategory as ModerationCategory)
    ? rawCategory as ModerationCategory
    : 'safe';
  const decision = typeof record.decision === 'string' ? record.decision.trim().toLowerCase() : 'allow';
  const numericConfidence = typeof record.confidence === 'number'
    ? record.confidence
    : Number(record.confidence ?? 0);
  const confidence = Number.isFinite(numericConfidence)
    ? Math.max(0, Math.min(1, numericConfidence))
    : 0;
  const rawThreshold = Number(configuredThreshold ?? 0.82);
  const threshold = Number.isFinite(rawThreshold)
    ? Math.max(0.5, Math.min(0.99, rawThreshold))
    : 0.82;
  const effectiveThreshold = category === 'sexual_minors' ? Math.min(threshold, 0.65) : threshold;
  const allowed = !(
    decision === 'block'
    && category !== 'safe'
    && confidence >= effectiveThreshold
  );

  return { allowed, category, confidence };
}

function arkRecognitionPlugin(apiKey?: string, moderationThreshold?: string): Plugin {
  const routeHandler = (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
    next: () => void
  ) => {
    const pathname = request.url?.split('?')[0];
    if (
      pathname !== '/api/artwork-features'
      && pathname !== '/api/ai-recognize'
      && pathname !== '/api/content-moderation'
    ) {
      next();
      return;
    }

    void handler(request, response, pathname);
  };

  const handler = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
    pathname?: string
  ) => {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (!apiKey) {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'ARK_API_KEY is not configured' }));
      return;
    }

    try {
      const body = await parseRequestBody(request);

      if (!body || !body.imageDataUrl) {
        writeJson(response, body ? 400 : 500, { error: 'imageDataUrl is required' });
        return;
      }

      const imageDataUrl = body.imageDataUrl as string;

      const isFeatureRequest = pathname === '/api/artwork-features';
      const isModerationRequest = pathname === '/api/content-moderation';
      const arkResponse = await fetch(ARK_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: ARK_MODEL,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: imageDataUrl
                },
                {
                  type: 'input_text',
                  text: isModerationRequest
                    ? createContentModerationPrompt()
                    : isFeatureRequest
                      ? createArtworkFeaturePrompt()
                      : createLegacyRecognitionPrompt()
                }
              ]
            }
          ]
        })
      });

      const arkPayload = await arkResponse.json();

      if (!arkResponse.ok) {
        response.statusCode = arkResponse.status;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: 'Ark recognition failed', detail: arkPayload }));
        return;
      }

      const outputText = extractTextFromArkResponse(arkPayload);
      const parsed = parseJsonFromModelText(outputText);

      if (isModerationRequest) {
        const result = normalizeModerationResult(parsed, moderationThreshold);
        if (!result.allowed) {
          writeJson(response, 422, {
            ...result,
            code: 'CONTENT_MODERATION_REJECTED',
            message: moderationMessage(result.category)
          });
          return;
        }
        writeJson(response, 200, result);
        return;
      }

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(isFeatureRequest ? { features: parsed } : { analysis: parsed }));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown recognition error'
      }));
    }
  };

  return {
    name: 'ark-recognition-api',
    configureServer(server) {
      server.middlewares.use(routeHandler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(routeHandler);
    }
  };
}

function arkHyper3DPlugin(apiKey?: string): Plugin {
  const routeHandler = (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
    next: () => void
  ) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/artwork-3d/tasks' && request.method === 'POST') {
      void createTask(request, response);
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/artwork-3d\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === 'GET') {
      void readTask(taskMatch[1], response);
      return;
    }

    if (url.pathname === '/api/artwork-3d/model' && request.method === 'GET') {
      void proxyModel(url.searchParams.get('url'), response);
      return;
    }

    next();
  };

  const createTask = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse
  ) => {
    if (!apiKey) {
      writeJson(response, 503, { error: 'ARK_API_KEY is not configured' });
      return;
    }

    try {
      const body = await parseRequestBody(request);

      if (!body || !body.imageDataUrl) {
        writeJson(response, body ? 400 : 500, { error: 'imageDataUrl is required' });
        return;
      }

      const imageDataUrl = body.imageDataUrl as string;
      const seed = normalizeHyper3DSeed(body.seed);

      const arkResponse = await fetch(ARK_CONTENT_TASKS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: ARK_3D_MODEL,
          content: [
            {
              type: 'text',
              text: createHyper3DPrompt()
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ],
          seed
        })
      });

      const payload = await arkResponse.json();

      if (!arkResponse.ok) {
        writeJson(response, arkResponse.status, { error: 'Ark 3D generation task failed', detail: payload });
        return;
      }

      const taskId = extractFirstStringByKeys(payload, ['id', 'task_id', 'taskId']);
      if (!taskId) {
        writeJson(response, 502, { error: 'Ark 3D generation response did not include a task id', detail: payload });
        return;
      }

      writeJson(response, 200, {
        taskId,
        state: normalizeTaskState(payload),
        modelUrl: extractGeneratedModelUrl(payload),
        raw: payload
      });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown 3D generation error'
      });
    }
  };

  const readTask = async (
    taskId: string,
    response: import('node:http').ServerResponse
  ) => {
    if (!apiKey) {
      writeJson(response, 503, { error: 'ARK_API_KEY is not configured' });
      return;
    }

    try {
      const arkResponse = await fetch(`${ARK_CONTENT_TASKS_URL}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      const payload = await arkResponse.json();

      if (!arkResponse.ok) {
        writeJson(response, arkResponse.status, { error: 'Ark 3D generation task polling failed', detail: payload });
        return;
      }

      const modelUrl = extractGeneratedModelUrl(payload);
      writeJson(response, 200, {
        taskId,
        state: modelUrl ? 'succeeded' : normalizeTaskState(payload),
        modelUrl,
        raw: payload
      });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown 3D task polling error'
      });
    }
  };

  const proxyModel = async (
    modelUrl: string | null,
    response: import('node:http').ServerResponse
  ) => {
    if (!modelUrl || !/^https?:\/\//i.test(modelUrl)) {
      response.statusCode = 400;
      response.end('Missing or invalid model url');
      return;
    }

    try {
      const upstream = await fetch(modelUrl);
      if (!upstream.ok) {
        response.statusCode = upstream.status;
        response.end(await upstream.text());
        return;
      }

      response.statusCode = 200;
      response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'model/gltf-binary');
      response.setHeader('Cache-Control', 'public, max-age=3600');
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : 'Unknown model proxy error');
    }
  };

  return {
    name: 'ark-hyper3d-api',
    configureServer(server) {
      server.middlewares.use(routeHandler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(routeHandler);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const triposplatApiTarget = env.TRIPOSPLAT_API_TARGET?.trim()
    || DEFAULT_TRIPOSPLAT_API_TARGET;
  const dadakidoApiTarget = env.DADAKIDO_API_TARGET?.trim()
    || DEFAULT_DADAKIDO_API_TARGET;
  const dadakidoCheckInApiTarget = env.DADAKIDO_CHECKIN_API_TARGET?.trim()
    || DEFAULT_DADAKIDO_CHECKIN_API_TARGET;

  return {
    plugins: [
      react(),
      arkRecognitionPlugin(env.ARK_API_KEY, env.CONTENT_MODERATION_THRESHOLD)
    ],
    resolve: {
      dedupe: ['react', 'react-dom']
    },
    server: {
      allowedHosts: ['.trycloudflare.com', '.yzzwnw.asia'],
      proxy: createDevProxy(triposplatApiTarget, dadakidoApiTarget, dadakidoCheckInApiTarget)
    },
    preview: {
      allowedHosts: ['.trycloudflare.com', '.yzzwnw.asia'],
      proxy: createDevProxy(triposplatApiTarget, dadakidoApiTarget, dadakidoCheckInApiTarget)
    }
  };
});
