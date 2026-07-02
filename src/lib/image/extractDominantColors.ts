const SAMPLE_SIZE = 96;
const MAX_COLORS = 5;
const WHITE_THRESHOLD = 238;
const ALPHA_THRESHOLD = 24;

type ColorBin = {
  r: number;
  g: number;
  b: number;
  count: number;
  saturation: number;
};

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
      reject(new Error('Unable to read artwork colors.'));
    };

    image.src = url;
  });
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function saturationOf(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function isUsefulPixel(r: number, g: number, b: number, a: number) {
  if (a < ALPHA_THRESHOLD) return false;
  if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) return false;
  return true;
}

export async function extractDominantColorsFromImage(file: File): Promise<string[]> {
  const image = await loadImage(file);
  const ratio = Math.min(SAMPLE_SIZE / image.width, SAMPLE_SIZE / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    return ['#64D9FF', '#FFD166', '#BBA7FF'];
  }

  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const bins = new Map<string, ColorBin>();

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (!isUsefulPixel(r, g, b, a)) continue;

    const qr = Math.round(r / 28) * 28;
    const qg = Math.round(g / 28) * 28;
    const qb = Math.round(b / 28) * 28;
    const key = `${qr}-${qg}-${qb}`;
    const current = bins.get(key);

    if (current) {
      current.r += r;
      current.g += g;
      current.b += b;
      current.count += 1;
    } else {
      bins.set(key, {
        r,
        g,
        b,
        count: 1,
        saturation: saturationOf(r, g, b)
      });
    }
  }

  const colors = Array.from(bins.values())
    .map((bin) => ({
      r: bin.r / bin.count,
      g: bin.g / bin.count,
      b: bin.b / bin.count,
      count: bin.count,
      score: bin.count * (0.7 + bin.saturation * 0.65)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COLORS)
    .map((bin) => rgbToHex(bin.r, bin.g, bin.b));

  return colors.length ? colors : ['#64D9FF', '#FFD166', '#BBA7FF'];
}
