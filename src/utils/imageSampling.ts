export const SAMPLE_SIZE = 180;
export const MAX_PARTICLES_PER_ARTWORK = 1200;
export const MIN_ALPHA = 20;
export const WHITE_THRESHOLD = 245;
export const TARGET_ARTWORK_SIZE = 1.25;

export type SampledPoint = {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  brightness: number;
  edge: number;
  scatter: number;
};

export type SampledParticleShape = {
  id: string;
  name: string;
  texture: string;
  mask?: string;
  aiSource: 'mock' | 'api' | 'local';
  points: SampledPoint[];
  originalSize: {
    width: number;
    height: number;
  };
  processedSize: {
    width: number;
    height: number;
  };
  scaledDown: boolean;
  nonWhitePixelCount: number;
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type RawPixelPoint = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  brightness: number;
  edge: number;
  weight: number;
};

type SampleImageInput = {
  id: string;
  name: string;
  texture: File | Blob;
  mask?: File | Blob;
  aiSource?: 'mock' | 'api' | 'local';
};

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isNonWhitePixel(r: number, g: number, b: number, a: number) {
  if (a < MIN_ALPHA) return false;

  const brightness = (r + g + b) / 3;
  const colorSpread = Math.max(r, g, b) - Math.min(r, g, b);
  return brightness < WHITE_THRESHOLD || colorSpread > 18;
}

function getProcessingSize(width: number, height: number) {
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaledDown: scale < 1
  };
}

function createBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function addToBounds(bounds: Bounds, x: number, y: number) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function getMaskValue(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return mask[y * width + x];
}

function computeEdgeStrength(mask: Uint8Array, brightness: Float32Array, width: number, height: number, x: number, y: number) {
  const i = y * width + x;
  const center = brightness[i];
  const horizontal = Math.abs(center - brightness[y * width + Math.min(width - 1, x + 1)])
    + Math.abs(center - brightness[y * width + Math.max(0, x - 1)]);
  const vertical = Math.abs(center - brightness[Math.min(height - 1, y + 1) * width + x])
    + Math.abs(center - brightness[Math.max(0, y - 1) * width + x]);
  const silhouette = 4 - (
    getMaskValue(mask, width, height, x + 1, y)
    + getMaskValue(mask, width, height, x - 1, y)
    + getMaskValue(mask, width, height, x, y + 1)
    + getMaskValue(mask, width, height, x, y - 1)
  );

  return Math.min(1, horizontal * 0.72 + vertical * 0.72 + Math.max(0, silhouette) * 0.28);
}

function weightedSampleRawPoints(points: RawPixelPoint[], count: number) {
  if (count <= 0 || points.length === 0) return [];
  if (points.length <= count) return points;

  const sampled: RawPixelPoint[] = [];
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const step = totalWeight / count;
  let cursor = Math.random() * step;
  let accumulated = 0;
  let pointIndex = 0;

  for (let i = 0; i < count; i += 1) {
    const target = cursor + i * step;
    while (pointIndex < points.length - 1 && accumulated + points[pointIndex].weight < target) {
      accumulated += points[pointIndex].weight;
      pointIndex += 1;
    }
    sampled.push(points[pointIndex]);
  }

  return sampled;
}

function sampleArtworkPoints(points: RawPixelPoint[]) {
  const edgePoints = points.filter((point) => point.edge > 0.18);
  const fillPoints = points.filter((point) => point.edge <= 0.18);
  const edgeTarget = Math.min(edgePoints.length, Math.round(MAX_PARTICLES_PER_ARTWORK * 0.4));
  const fillTarget = Math.min(fillPoints.length, MAX_PARTICLES_PER_ARTWORK - edgeTarget);
  const extraTarget = MAX_PARTICLES_PER_ARTWORK - edgeTarget - fillTarget;
  const sampled = [
    ...weightedSampleRawPoints(edgePoints, edgeTarget),
    ...weightedSampleRawPoints(fillPoints, fillTarget),
    ...weightedSampleRawPoints(points, extraTarget)
  ];

  return sampled.length > MAX_PARTICLES_PER_ARTWORK
    ? weightedSampleRawPoints(sampled, MAX_PARTICLES_PER_ARTWORK)
    : sampled;
}

function normalizePoints(points: RawPixelPoint[], bounds: Bounds): SampledPoint[] {
  const width = Math.max(bounds.maxX - bounds.minX + 1, 1);
  const height = Math.max(bounds.maxY - bounds.minY + 1, 1);
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  const scale = TARGET_ARTWORK_SIZE / Math.max(width, height);

  return points.map((point) => {
    const normalizedX = (point.x - centerX) * scale;
    const normalizedY = -(point.y - centerY) * scale;
    const edgeScatter = point.edge * (0.002 + Math.random() * 0.005);
    const depthRelief = (1 - point.brightness) * 0.32 + point.edge * 0.18;

    return {
      x: normalizedX + (Math.random() - 0.5) * edgeScatter,
      y: normalizedY + (Math.random() - 0.5) * edgeScatter,
      z: depthRelief * 0.16 + (Math.random() - 0.5) * 0.018,
      color: [point.r / 255, point.g / 255, point.b / 255],
      brightness: point.brightness,
      edge: point.edge,
      scatter: edgeScatter
    };
  });
}

async function decodeImage(file: File) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to decode image.'));
    };
    image.src = url;
  });
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read generated texture.'));
    reader.readAsDataURL(blob);
  });
}

export async function sampleCreatureTexture(input: SampleImageInput): Promise<SampledParticleShape> {
  const textureFile = input.texture instanceof File ? input.texture : new File([input.texture], input.name, { type: input.texture.type });
  const image = await decodeImage(textureFile);
  const originalWidth = image.width;
  const originalHeight = image.height;
  const processedSize = getProcessingSize(originalWidth, originalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = processedSize.width;
  canvas.height = processedSize.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if ('close' in image && typeof image.close === 'function') {
    image.close();
  }

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const texture = canvas.toDataURL('image/webp', 0.72);
  const mask = input.mask ? await blobToDataUrl(input.mask) : undefined;
  const bounds = createBounds();
  const activeMask = new Uint8Array(canvas.width * canvas.height);
  const brightnessMap = new Float32Array(canvas.width * canvas.height);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const pixelIndex = y * canvas.width + x;
      const offset = pixelIndex * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const a = pixels[offset + 3];
      const bright = luminance(r, g, b);

      brightnessMap[pixelIndex] = bright;
      if (isNonWhitePixel(r, g, b, a)) {
        activeMask[pixelIndex] = 1;
        addToBounds(bounds, x, y);
      }
    }
  }

  const rawPoints: RawPixelPoint[] = [];

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const pixelIndex = y * canvas.width + x;
      if (!activeMask[pixelIndex]) continue;

      const offset = pixelIndex * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const brightness = brightnessMap[pixelIndex];
      const edge = computeEdgeStrength(activeMask, brightnessMap, canvas.width, canvas.height, x, y);
      const darkness = 1 - brightness;
      const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const weight = 0.2 + darkness * 0.8 + saturation * 0.35 + edge * 1.45;

      rawPoints.push({ x, y, r, g, b, brightness, edge, weight });
    }
  }

  if (rawPoints.length < 12) {
    throw new Error('No clear drawing found. Try a darker drawing on white paper.');
  }

  return {
    id: `${input.id}-${rawPoints.length}`,
    name: input.name,
    texture,
    mask,
    aiSource: input.aiSource ?? 'local',
    points: normalizePoints(sampleArtworkPoints(rawPoints), bounds),
    originalSize: {
      width: originalWidth,
      height: originalHeight
    },
    processedSize: {
      width: canvas.width,
      height: canvas.height
    },
    scaledDown: processedSize.scaledDown,
    nonWhitePixelCount: rawPoints.length
  };
}

export async function sampleImageFile(file: File): Promise<SampledParticleShape> {
  return sampleCreatureTexture({
    id: `${file.name}-${file.lastModified}`,
    name: file.name,
    texture: file,
    aiSource: 'local'
  });
}
