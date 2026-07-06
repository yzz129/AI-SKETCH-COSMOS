import { imageDataToParticleCloud, type ParticleCloudPoint } from './imageToParticleCloud';

export type ArtworkParticle = ParticleCloudPoint;

export type ProcessedArtworkImage = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  aspect: number;
  particles: ArtworkParticle[];
};

const MAX_CANVAS_SIZE = 1024;
const WHITE_THRESHOLD = 242;
const ALPHA_THRESHOLD = 20;
const BACKGROUND_PROTECTION_RADIUS = 1;

function isWhitePixel(r: number, g: number, b: number) {
  return r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD;
}

function pixelIndex(width: number, x: number, y: number) {
  return y * width + x;
}

function pixelOffset(width: number, x: number, y: number) {
  return pixelIndex(width, x, y) * 4;
}

function isBackgroundCandidate(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const offset = pixelOffset(width, x, y);
  return data[offset + 3] >= ALPHA_THRESHOLD
    && isWhitePixel(data[offset], data[offset + 1], data[offset + 2]);
}

function createProtectedMask(data: Uint8ClampedArray, width: number, height: number) {
  const protectedMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset(width, x, y);
      const isForeground = data[offset + 3] >= ALPHA_THRESHOLD
        && !isWhitePixel(data[offset], data[offset + 1], data[offset + 2]);

      if (!isForeground) continue;

      for (let dy = -BACKGROUND_PROTECTION_RADIUS; dy <= BACKGROUND_PROTECTION_RADIUS; dy += 1) {
        for (let dx = -BACKGROUND_PROTECTION_RADIUS; dx <= BACKGROUND_PROTECTION_RADIUS; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          protectedMask[pixelIndex(width, px, py)] = 1;
        }
      }
    }
  }

  return protectedMask;
}

function findEdgeConnectedBackground(data: Uint8ClampedArray, width: number, height: number) {
  const protectedMask = createProtectedMask(data, width, height);
  const backgroundMask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (x: number, y: number) => {
    const index = pixelIndex(width, x, y);
    if (backgroundMask[index] || protectedMask[index]) return;
    if (!isBackgroundCandidate(data, width, x, y)) return;

    backgroundMask[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;

    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }

  return backgroundMask;
}

function createId(name: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load artwork image.'));
    };
    image.src = url;
  });
}

export async function processArtworkImage(file: File): Promise<ProcessedArtworkImage> {
  const image = await loadImage(file);
  const ratio = Math.min(
    MAX_CANVAS_SIZE / image.width,
    MAX_CANVAS_SIZE / image.height,
    1
  );
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    throw new Error('Canvas context is not available.');
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const edgeConnectedBackground = findEdgeConnectedBackground(data, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const maskIndex = pixelIndex(width, x, y);
      const i = maskIndex * 4;
      const a = data[i + 3];

      if (a < ALPHA_THRESHOLD || edgeConnectedBackground[maskIndex]) {
        data[i + 3] = 0;
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('No clear artwork found. Try a darker drawing on white paper.');
  }

  context.putImageData(imageData, 0, 0);

  const croppedWidth = maxX - minX + 1;
  const croppedHeight = maxY - minY + 1;
  const cropCanvas = document.createElement('canvas');
  const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });

  cropCanvas.width = croppedWidth;
  cropCanvas.height = croppedHeight;

  if (!cropContext) {
    throw new Error('Crop canvas context is not available.');
  }

  cropContext.clearRect(0, 0, croppedWidth, croppedHeight);
  cropContext.drawImage(
    canvas,
    minX,
    minY,
    croppedWidth,
    croppedHeight,
    0,
    0,
    croppedWidth,
    croppedHeight
  );

  const croppedImageData = cropContext.getImageData(0, 0, croppedWidth, croppedHeight);

  return {
    id: createId(file.name),
    name: file.name,
    url: cropCanvas.toDataURL('image/png'),
    width: croppedWidth,
    height: croppedHeight,
    aspect: croppedWidth / croppedHeight,
    particles: imageDataToParticleCloud(croppedImageData, croppedWidth, croppedHeight)
  };
}
