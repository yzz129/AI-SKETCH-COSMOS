export type ParticleCloudPoint = {
  basePosition: [number, number, number];
  focusPosition?: [number, number, number];
  normal?: [number, number, number];
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
  isFocusSample?: boolean;
};

const TARGET_SIZE = 1.45;
const MIN_ALPHA = 20;
const MIN_PARTICLES = 7000;
const MAX_PARTICLES = 90000;
const DEFAULT_MAX_SAMPLE_SIZE = 512;
const MAX_EDGE_DISTANCE = 16;

function alphaAt(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return data[(y * width + x) * 4 + 3];
}

/**
 * BFS distance transform — computes Chebyshev distance from each foreground pixel
 * to the nearest edge/transparent pixel. Processes every pixel exactly once (O(n))
 * instead of the spiral-search O(n × r²).
 *
 * Map values: 0 = transparent, 1 = edge pixel, 2–17 = interior distance, 255 = unvisited.
 */
function computeEdgeMap(data: Uint8ClampedArray, width: number, height: number) {
  const total = width * height;
  const map = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  // Single-pass init: mark transparent, enqueue edges, flag interior
  for (let i = 0; i < total; i += 1) {
    const a = data[i * 4 + 3];
    if (a < MIN_ALPHA) {
      map[i] = 0;
      continue;
    }
    // Fast edge check on the fly
    const x = i % width;
    const y = (i / width) | 0;
    let isEdge = false;
    if (x === 0 || y === 0 || x >= width - 1 || y >= height - 1) {
      isEdge = true;
    } else {
      // Unrolled 8-neighbor check
      if (data[(i - width - 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i - width) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i - width + 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i - 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i + 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i + width - 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i + width) * 4 + 3] < MIN_ALPHA) isEdge = true;
      else if (data[(i + width + 1) * 4 + 3] < MIN_ALPHA) isEdge = true;
    }
    if (isEdge) {
      map[i] = 1;
      queue[tail++] = i;
    } else {
      map[i] = 255;
    }
  }

  // BFS outward from edges (8-neighbor → Chebyshev distance)
  const stride = width;
  while (head < tail) {
    const idx = queue[head++];
    const d = map[idx];
    if (d >= MAX_EDGE_DISTANCE) continue;

    const nd = d + 1;
    // Top-left
    let n = idx - stride - 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Top
    n = idx - stride;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Top-right
    n = idx - stride + 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Left
    n = idx - 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Right
    n = idx + 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Bottom-left
    n = idx + stride - 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Bottom
    n = idx + stride;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
    // Bottom-right
    n = idx + stride + 1;
    if (map[n] === 255) { map[n] = nd; queue[tail++] = n; }
  }

  // Remaining 255 → deep interior (clamp to MAX_EDGE_DISTANCE + 1)
  for (let i = 0; i < total; i += 1) {
    if (map[i] === 255) map[i] = MAX_EDGE_DISTANCE + 1;
  }

  return map;
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

function normalizeVector3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length < 0.0001) return [0, 0, 1];

  return [x / length, y / length, z / length];
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

  const focusSamples = points.filter((point) => point.isFocusSample);
  const edges = points.filter((point) => point.isEdge);
  const fills = points.filter((point) => !point.isEdge);
  const focusBudget = Math.min(focusSamples.length, Math.floor(MAX_PARTICLES * 0.34));
  const edgeBudget = Math.min(edges.length, Math.floor(MAX_PARTICLES * 0.3));
  const selected: ParticleCloudPoint[] = [];
  const selectedKeys = new Set<ParticleCloudPoint>();

  const stridePick = (items: ParticleCloudPoint[], budget: number) => {
    if (items.length <= budget) return items;
    const stride = items.length / budget;
    const picked: ParticleCloudPoint[] = [];

    for (let i = 0; i < budget; i += 1) {
      picked.push(items[Math.floor(i * stride)]);
    }

    return picked;
  };

  const pushUnique = (items: ParticleCloudPoint[]) => {
    for (const item of items) {
      if (selectedKeys.has(item)) continue;
      selected.push(item);
      selectedKeys.add(item);
    }
  };

  pushUnique(stridePick(focusSamples, focusBudget));
  pushUnique(stridePick(edges, edgeBudget));
  pushUnique(stridePick(fills, Math.max(0, MAX_PARTICLES - selected.length)));
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
  const step = 1;
  const centerX = sampleWidth / 2;
  const centerY = sampleHeight / 2;
  const scale = TARGET_SIZE / Math.max(sampleWidth, sampleHeight);
  const points: ParticleCloudPoint[] = [];
  const spanMetrics = createSpanMetrics(data, sampleWidth, sampleHeight);

  // Precompute edge distance map (BFS — O(n) instead of per-pixel spiral search O(n×r²))
  const edgeMap = computeEdgeMap(data, sampleWidth, sampleHeight);

  const pushPoint = (point: Omit<ParticleCloudPoint, 'x' | 'y' | 'z' | 'depthFactor'>) => {
    const [x, y, z] = point.basePosition;
    const clampedZ = clamp(z, -0.3, 0.36);
    points.push({
      ...point,
      basePosition: [x, y, clampedZ],
      x,
      y,
      z: clampedZ,
      depthFactor: clamp((clampedZ + 0.3) / 0.66, 0, 1)
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
      const edgeDist = edgeMap[y * sampleWidth + x]; // 0=bg, 1=edge, 2+=interior
      const edge = edgeDist === 1;
      const distanceToEdge = edge ? 0 : edgeDist;
      const thickness = clamp(distanceToEdge / MAX_EDGE_DISTANCE, 0, 1);
      const keepChance = edge ? 1 : validPixelCount > 70000 ? 0.9 + thickness * 0.08 : 0.94 + thickness * 0.05;

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
      const profileVolume = clamp(rowSpan * 0.58 + columnSpan * 0.18 + rowRoundness * 0.26 + columnRoundness * 0.12, 0.08, 1);
      const volume = clamp((thickness * 0.68 + centerVolume * 0.24 + rowRoundness * 0.26) * profileVolume, 0.04, 0.86);
      const brightBoost = brightness > 0.76 ? 0.12 : 0;
      const pixelX = (x - centerX) * scale;
      const pixelY = -(y - centerY) * scale;
      const rowCenterWorldX = (spanMetrics.rowCenters[y] - centerX) * scale;
      const columnCenterWorldY = -(spanMetrics.columnCenters[x] - centerY) * scale;
      const edgeFactor = edge ? 1 : 0;
      const phase = seededJitter(x, y, 5) * Math.PI * 2;
      const flowStrength = edge ? 0.18 : 0.54 + volume * 0.28 + seededJitter(x, y, 6) * 0.16;
      const baseAlpha = Math.min(1, Math.max(edge ? 0.92 : 0.84, a / 255));
      const shellDepth = (0.055 + volume * 0.34 + rowSpan * 0.055 + columnSpan * 0.03) * (edge ? 1.05 : 1);
      const layerCount = edge ? 5 : volume > 0.68 ? 5 : volume > 0.34 ? 4 : 3;
      const focusLayerIndex = Math.floor(layerCount / 2);

      for (let layer = 0; layer < layerCount; layer += 1) {
        const layerSeed = seededJitter(x, y, 20 + layer);
        const shell = edge
          ? -1 + (layer / Math.max(1, layerCount - 1)) * 2 + signedSeededJitter(x, y, 24 + layer) * 0.18
          : layerCount === 1
            ? 0
            : -1 + (layer / (layerCount - 1)) * 2 + signedSeededJitter(x, y, 25 + layer) * 0.28;
        const shellAbs = Math.min(1, Math.abs(shell));
        const crossSectionShrink = 1 - shellAbs * volume * (edge ? 0.22 : 0.34);
        const sidePush = signedSeededJitter(x, y, 30 + layer) * volume * scale * 0.44;
        const liftPush = signedSeededJitter(x, y, 34 + layer) * volume * scale * 0.36;
        const jitterX = signedSeededJitter(x, y, 2 + layer) * scale * (edge ? 0.06 : 0.16);
        const jitterY = signedSeededJitter(x, y, 7 + layer) * scale * (edge ? 0.06 : 0.16);
        const z = shell * shellDepth
          + rowRoundness * volume * 0.055
          + columnRoundness * volume * 0.022
          + (brightness - 0.5) * 0.03
          + signedSeededJitter(x, y, 11 + layer) * 0.02;
        const particleX = rowCenterWorldX + (pixelX - rowCenterWorldX) * crossSectionShrink + sidePush + jitterX;
        const particleY = columnCenterWorldY + (pixelY - columnCenterWorldY) * crossSectionShrink + liftPush + jitterY;
        const layerAlpha = baseAlpha * (edge ? 0.22 + (1 - shellAbs) * 0.15 : 0.22 + (1 - shellAbs) * 0.17);
        const layerSize = edge
          ? 1.1 + brightBoost * 0.18
          : 1.02 + volume * 0.26 + (1 - shellAbs) * 0.16 + brightBoost * 0.16;
        const normalFromCenterX = particleX - rowCenterWorldX;
        const normalFromCenterY = particleY - columnCenterWorldY;
        const sideNormal = normalizeVector3(
          normalFromCenterX * (edge ? 1.28 : 0.78),
          normalFromCenterY * (edge ? 1.18 : 0.82),
          shell * shellDepth * (edge ? 1.8 : 2.25) + 0.04
        );

        pushPoint({
          basePosition: [particleX, particleY, z],
          focusPosition: [pixelX, pixelY, 0],
          normal: sideNormal,
          r,
          g,
          b,
          alpha: layerAlpha,
          size: layerSize,
          phase: phase + layerSeed * Math.PI,
          flowStrength,
          edgeFactor,
          brightness,
          isEdge: edge,
          isFocusSample: layer === focusLayerIndex
        });
      }
    }
  }

  return limitParticles(points);
}
