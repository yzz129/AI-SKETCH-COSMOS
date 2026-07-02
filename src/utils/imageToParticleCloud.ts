export type ParticleCloudPoint = {
  basePosition: [number, number, number];
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  size: number;
  phase: number;
  flowStrength: number;
  edgeFactor: number;
  brightness: number;
  depthFactor: number;
  isEdge: boolean;
};

const TARGET_SIZE = 1.45;
const MIN_ALPHA = 20;
const MIN_PARTICLES = 7000;
const MAX_PARTICLES = 30000;
const DEFAULT_MAX_SAMPLE_SIZE = 360;
const MAX_EDGE_DISTANCE = 16;

function alphaAt(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return data[(y * width + x) * 4 + 3];
}

function isEdgePixel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (alphaAt(data, width, height, x + dx, y + dy) < MIN_ALPHA) {
        return true;
      }
    }
  }

  return false;
}

function edgeDistance(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  if (isEdgePixel(data, width, height, x, y)) return 0;

  for (let radius = 2; radius <= MAX_EDGE_DISTANCE; radius += 1) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
        if (alphaAt(data, width, height, x + ox, y + oy) < MIN_ALPHA) return radius;
      }
    }
  }

  return MAX_EDGE_DISTANCE;
}

function seededJitter(x: number, y: number, channel: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + channel * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function signedSeededJitter(x: number, y: number, channel: number) {
  return seededJitter(x, y, channel) * 2 - 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createSpanMetrics(data: Uint8ClampedArray, width: number, height: number) {
  const rowWidths = new Float32Array(height);
  const rowCenters = new Float32Array(height);
  const columnHeights = new Float32Array(width);
  const columnCenters = new Float32Array(width);
  let maxRowWidth = 1;
  let maxColumnHeight = 1;

  for (let y = 0; y < height; y += 1) {
    let minX = width;
    let maxX = -1;

    for (let x = 0; x < width; x += 1) {
      if (alphaAt(data, width, height, x, y) < MIN_ALPHA) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }

    if (maxX >= minX) {
      const span = maxX - minX + 1;
      rowWidths[y] = span;
      rowCenters[y] = (minX + maxX) * 0.5;
      maxRowWidth = Math.max(maxRowWidth, span);
    } else {
      rowCenters[y] = width * 0.5;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let minY = height;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      if (alphaAt(data, width, height, x, y) < MIN_ALPHA) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (maxY >= minY) {
      const span = maxY - minY + 1;
      columnHeights[x] = span;
      columnCenters[x] = (minY + maxY) * 0.5;
      maxColumnHeight = Math.max(maxColumnHeight, span);
    } else {
      columnCenters[x] = height * 0.5;
    }
  }

  return {
    rowWidths,
    rowCenters,
    columnHeights,
    columnCenters,
    maxRowWidth,
    maxColumnHeight
  };
}

function limitParticles(points: ParticleCloudPoint[]) {
  if (points.length <= MAX_PARTICLES) return points;

  const edges = points.filter((point) => point.isEdge);
  const fills = points.filter((point) => !point.isEdge);
  const edgeBudget = Math.min(edges.length, Math.floor(MAX_PARTICLES * 0.32));
  const fillBudget = MAX_PARTICLES - edgeBudget;
  const selected: ParticleCloudPoint[] = [];

  const stridePick = (items: ParticleCloudPoint[], budget: number) => {
    if (items.length <= budget) return items;
    const stride = items.length / budget;
    const picked: ParticleCloudPoint[] = [];

    for (let i = 0; i < budget; i += 1) {
      picked.push(items[Math.floor(i * stride)]);
    }

    return picked;
  };

  selected.push(...stridePick(edges, edgeBudget));
  selected.push(...stridePick(fills, fillBudget));
  return selected;
}

export function imageDataToParticleCloud(
  imageData: ImageData,
  width: number,
  height: number,
  maxSampleSize = DEFAULT_MAX_SAMPLE_SIZE
) {
  const sampleRatio = Math.min(maxSampleSize / width, maxSampleSize / height, 1);
  const sampleWidth = Math.max(1, Math.round(width * sampleRatio));
  const sampleHeight = Math.max(1, Math.round(height * sampleRatio));
  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const sampleCanvas = document.createElement('canvas');
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

  if (!sourceContext || !sampleContext) {
    throw new Error('Canvas context is not available for particle sampling.');
  }

  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceContext.putImageData(imageData, 0, 0);
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
  sampleContext.imageSmoothingEnabled = true;
  sampleContext.imageSmoothingQuality = 'high';
  sampleContext.drawImage(sourceCanvas, 0, 0, sampleWidth, sampleHeight);

  const sampled = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
  const data = sampled.data;
  const validPixelCount = Math.ceil(data.length / 4);
  const step = validPixelCount > 90000 ? 2 : 1;
  const centerX = sampleWidth / 2;
  const centerY = sampleHeight / 2;
  const scale = TARGET_SIZE / Math.max(sampleWidth, sampleHeight);
  const points: ParticleCloudPoint[] = [];
  const spanMetrics = createSpanMetrics(data, sampleWidth, sampleHeight);

  const pushPoint = (point: Omit<ParticleCloudPoint, 'x' | 'y' | 'z' | 'depthFactor'>) => {
    const [x, y, z] = point.basePosition;
    const clampedZ = clamp(z, -0.28, 0.34);
    points.push({
      ...point,
      basePosition: [x, y, clampedZ],
      x,
      y,
      z: clampedZ,
      depthFactor: clamp((clampedZ + 0.28) / 0.62, 0, 1)
    });
  };

  for (let y = 0; y < sampleHeight; y += step) {
    for (let x = 0; x < sampleWidth; x += step) {
      const offset = (y * sampleWidth + x) * 4;
      const a = data[offset + 3];
      if (a < MIN_ALPHA) continue;

      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const edge = isEdgePixel(data, sampleWidth, sampleHeight, x, y);
      const distanceToEdge = edgeDistance(data, sampleWidth, sampleHeight, x, y);
      const thickness = clamp(distanceToEdge / MAX_EDGE_DISTANCE, 0, 1);
      const keepChance = edge ? 0.98 : validPixelCount > 70000 ? 0.62 + thickness * 0.2 : 0.78 + thickness * 0.16;

      if (points.length > MIN_PARTICLES && seededJitter(x, y, 1) > keepChance) continue;

      const normalizedX = (x - centerX) / Math.max(sampleWidth, 1);
      const normalizedY = (y - centerY) / Math.max(sampleHeight, 1);
      const distanceFromCenter = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const centerVolume = Math.max(0, 1 - distanceFromCenter * 1.6);
      const brightness = (r + g + b) / 765;
      const rowSpan = spanMetrics.rowWidths[y] / spanMetrics.maxRowWidth;
      const columnSpan = spanMetrics.columnHeights[x] / spanMetrics.maxColumnHeight;
      const rowCenterOffset = spanMetrics.rowWidths[y] > 0
        ? Math.abs(x - spanMetrics.rowCenters[y]) / Math.max(1, spanMetrics.rowWidths[y] * 0.5)
        : 1;
      const columnCenterOffset = spanMetrics.columnHeights[x] > 0
        ? Math.abs(y - spanMetrics.columnCenters[x]) / Math.max(1, spanMetrics.columnHeights[x] * 0.5)
        : 1;
      const rowRoundness = Math.sqrt(clamp(1 - rowCenterOffset * rowCenterOffset, 0, 1));
      const columnRoundness = Math.sqrt(clamp(1 - columnCenterOffset * columnCenterOffset, 0, 1));
      const profileVolume = clamp(rowSpan * 0.68 + columnSpan * 0.2 + rowRoundness * 0.25 + columnRoundness * 0.12, 0.08, 1);
      const volume = clamp((thickness * 0.82 + centerVolume * 0.28 + rowRoundness * 0.34) * profileVolume, 0.04, 1);
      const brightBoost = brightness > 0.76 ? 0.12 : 0;
      const pixelX = (x - centerX) * scale;
      const pixelY = -(y - centerY) * scale;
      const rowCenterWorldX = (spanMetrics.rowCenters[y] - centerX) * scale;
      const columnCenterWorldY = -(spanMetrics.columnCenters[x] - centerY) * scale;
      const edgeFactor = edge ? 1 : 0;
      const phase = seededJitter(x, y, 5) * Math.PI * 2;
      const flowStrength = edge ? 0.18 : 0.54 + volume * 0.28 + seededJitter(x, y, 6) * 0.16;
      const baseAlpha = Math.min(1, Math.max(edge ? 0.92 : 0.84, a / 255));
      const shellDepth = (0.06 + volume * 0.36 + rowSpan * 0.06) * (edge ? 0.68 : 1);
      const layerCount = edge ? 3 : volume > 0.72 ? 5 : volume > 0.38 ? 4 : 3;

      for (let layer = 0; layer < layerCount; layer += 1) {
        const layerSeed = seededJitter(x, y, 20 + layer);
        const shell = edge
          ? -1 + (layer / Math.max(1, layerCount - 1)) * 2 + signedSeededJitter(x, y, 24 + layer) * 0.18
          : layerCount === 1
            ? 0
            : -1 + (layer / (layerCount - 1)) * 2 + signedSeededJitter(x, y, 25 + layer) * 0.28;
        const shellAbs = Math.min(1, Math.abs(shell));
        const crossSectionShrink = 1 - shellAbs * volume * (edge ? 0.18 : 0.48);
        const sidePush = signedSeededJitter(x, y, 30 + layer) * volume * scale * 0.88;
        const liftPush = signedSeededJitter(x, y, 34 + layer) * volume * scale * 0.76;
        const jitterX = signedSeededJitter(x, y, 2 + layer) * scale * (edge ? 0.1 : 0.3);
        const jitterY = signedSeededJitter(x, y, 7 + layer) * scale * (edge ? 0.1 : 0.3);
        const z = shell * shellDepth
          + rowRoundness * volume * 0.08
          + (brightness - 0.5) * 0.055
          + signedSeededJitter(x, y, 11 + layer) * 0.025;
        const particleX = rowCenterWorldX + (pixelX - rowCenterWorldX) * crossSectionShrink + sidePush + jitterX;
        const particleY = columnCenterWorldY + (pixelY - columnCenterWorldY) * crossSectionShrink + liftPush + jitterY;
        const layerAlpha = baseAlpha * (edge ? 0.34 + (1 - shellAbs) * 0.2 : 0.5 + (1 - shellAbs) * 0.28);
        const layerSize = edge
          ? 1.72 + brightBoost * 0.5
          : 1.62 + volume * 0.46 + (1 - shellAbs) * 0.34 + brightBoost * 0.5;

        pushPoint({
          basePosition: [particleX, particleY, z],
          r,
          g,
          b,
          alpha: layerAlpha,
          size: layerSize,
          phase: phase + layerSeed * Math.PI,
          flowStrength,
          edgeFactor,
          brightness,
          isEdge: edge
        });
      }
    }
  }

  return limitParticles(points);
}
