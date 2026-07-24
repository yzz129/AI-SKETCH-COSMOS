const CHINESE_SENSITIVE_PHRASES = [
  '成人视频',
  '色情视频',
  '色情网站',
  '恐怖袭击',
  '杀人狂',
  '杀人魔',
  '强奸',
  '性侵',
  '乱伦',
  '性虐',
  '裸聊',
  '约炮',
  '援交',
  '卖淫',
  '嫖娼',
  '黄片',
  '黄网',
  '色情',
  '淫秽',
  '虐杀',
  '分尸',
  '碎尸',
  '斩首',
  '屠杀',
  '灭门',
  '爆头',
  '血腥'
] as const;

// English terms use word boundaries so names such as "Essex" are not masked.
const LATIN_SENSITIVE_PHRASES = ['porn', 'porno', 'hentai', 'rape', 'gangbang'] as const;
const MODERATION_ENDPOINT = '/api/content-moderation';
const MODERATION_REQUIRED = import.meta.env.VITE_CONTENT_MODERATION_REQUIRED !== 'false';
const MODERATION_ENABLED = import.meta.env.VITE_CONTENT_MODERATION_ENABLED !== 'false';

export const CONTENT_MODERATION_REJECTED = 'CONTENT_MODERATION_REJECTED';
export const CONTENT_MODERATION_UNAVAILABLE = 'CONTENT_MODERATION_UNAVAILABLE';

export type ArtworkModerationCategory = 'safe' | 'graphic_violence' | 'sexual_explicit' | 'sexual_minors';

type ArtworkModerationPayload = {
  allowed?: boolean;
  category?: ArtworkModerationCategory;
  code?: string;
  confidence?: number;
  message?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function separatedPhrasePattern(phrase: string) {
  const separator = '[\\s._\\-\u00b7~*]*';
  return Array.from(phrase).map(escapeRegExp).join(separator);
}

function starsFor(value: string) {
  return '*'.repeat(Array.from(value).length);
}

/**
 * Masks only explicit, multi-character sensitive phrases. Ambiguous single
 * characters are intentionally excluded to keep ordinary nicknames intact.
 */
export function maskSensitiveText(value: string) {
  let masked = value;

  for (const phrase of CHINESE_SENSITIVE_PHRASES) {
    masked = masked.replace(new RegExp(separatedPhrasePattern(phrase), 'giu'), starsFor);
  }

  for (const phrase of LATIN_SENSITIVE_PHRASES) {
    masked = masked.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'giu'), starsFor);
  }

  return masked;
}

function categoryMessage(category?: ArtworkModerationCategory) {
  if (category === 'graphic_violence') {
    return '检测到图片含有明显血腥或严重暴力内容，请重新上传健康、非血腥的作品。';
  }
  if (category === 'sexual_explicit' || category === 'sexual_minors') {
    return '检测到图片含有色情或不适宜内容，请重新上传合适的作品。';
  }
  return '这张图片未通过内容安全检测，请重新上传其他作品。';
}

export class ArtworkModerationError extends Error {
  readonly code: string;
  readonly category?: ArtworkModerationCategory;

  constructor(message: string, code: string, category?: ArtworkModerationCategory) {
    super(message);
    this.name = 'ArtworkModerationError';
    this.code = code;
    this.category = category;
  }
}

export function isArtworkModerationError(error: unknown): error is ArtworkModerationError {
  return error instanceof ArtworkModerationError;
}

export function isArtworkModerationRejection(error: unknown): error is ArtworkModerationError {
  return isArtworkModerationError(error) && error.code === CONTENT_MODERATION_REJECTED;
}

export function moderationErrorFromPayload(payload: ArtworkModerationPayload) {
  const code = payload.code ?? CONTENT_MODERATION_REJECTED;
  const message = payload.message?.trim() || (
    code === CONTENT_MODERATION_REJECTED
      ? categoryMessage(payload.category)
      : '内容安全检测暂时不可用，请稍后重试。'
  );
  return new ArtworkModerationError(message, code, payload.category);
}

function fileToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取待检测图片。'));
    };
    reader.onerror = () => reject(new Error('无法读取待检测图片。'));
    reader.readAsDataURL(file);
  });
}

async function createModerationImageDataUrl(file: File) {
  if (typeof createImageBitmap !== 'function') return fileToDataUrl(file);

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('Unable to encode moderation image.')),
        'image/jpeg',
        0.86
      );
    });
    return fileToDataUrl(blob);
  } catch {
    return fileToDataUrl(file);
  }
}

async function readModerationPayload(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as ArtworkModerationPayload;
  } catch {
    return { message: text || response.statusText } satisfies ArtworkModerationPayload;
  }
}

export async function moderateArtworkImage(file: File, signal?: AbortSignal) {
  if (!MODERATION_ENABLED) return;

  try {
    const imageDataUrl = await createModerationImageDataUrl(file);
    const response = await fetch(MODERATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
      signal
    });
    const payload = await readModerationPayload(response);

    if (response.status === 422 || payload.allowed === false || payload.code === CONTENT_MODERATION_REJECTED) {
      throw moderationErrorFromPayload({ ...payload, code: CONTENT_MODERATION_REJECTED });
    }
    if (!response.ok) {
      if (!MODERATION_REQUIRED) {
        console.warn('[content-moderation] service unavailable; continuing because moderation is optional.', payload);
        return;
      }
      throw moderationErrorFromPayload({ ...payload, code: CONTENT_MODERATION_UNAVAILABLE });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (isArtworkModerationError(error)) throw error;
    if (!MODERATION_REQUIRED) {
      console.warn('[content-moderation] request failed; continuing because moderation is optional.', error);
      return;
    }
    throw new ArtworkModerationError(
      '内容安全检测暂时不可用，请稍后重试。',
      CONTENT_MODERATION_UNAVAILABLE
    );
  }
}
