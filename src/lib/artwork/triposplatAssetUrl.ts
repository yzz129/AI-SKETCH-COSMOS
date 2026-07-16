const ASSET_URL_KEYS = [
  'splatUrl',
  'plyUrl',
  'previewUrl',
  'manifestUrl',
  'rigUrl'
] as const;

function normalizedBase(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function withLeadingSlash(url: string) {
  return url.startsWith('/') ? url : `/${url}`;
}

function isLoopbackUrl(url: URL) {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

export function toClientAssetUrl(baseUrl: string, url?: string | null) {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const base = normalizedBase(baseUrl);

  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (isLoopbackUrl(parsed) && parsed.pathname.startsWith('/assets/') && !/^https?:\/\//i.test(base)) {
        return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return url;
    }
    return url;
  }

  const path = withLeadingSlash(url);
  if (!base || path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

export function toBackendAssetUrl(baseUrl: string, url?: string | null) {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const base = normalizedBase(baseUrl);

  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (isLoopbackUrl(parsed) && parsed.pathname.startsWith('/assets/')) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return url;
    }

    if (/^https?:\/\//i.test(base) && url.startsWith(`${base}/`)) {
      return withLeadingSlash(url.slice(base.length));
    }
    return url;
  }

  const path = withLeadingSlash(url);
  if (base && path.startsWith(`${base}/`)) {
    return withLeadingSlash(path.slice(base.length));
  }
  return path;
}

export function normalizeGaussianAssetUrlsForBackend<T>(baseUrl: string, model: T): T {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return model;

  const normalized = { ...model } as Record<string, unknown>;
  for (const key of ASSET_URL_KEYS) {
    const value = normalized[key];
    if (typeof value === 'string') normalized[key] = toBackendAssetUrl(baseUrl, value);
  }
  return normalized as T;
}
