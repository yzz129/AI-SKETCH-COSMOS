const MIN_GENERATION_SIZE = 384;
const MAX_GENERATION_SIZE = 768;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to prepare image for 3D generation.'));
    image.src = dataUrl;
  });
}

export async function prepareImageFor3DGeneration(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const largestSide = Math.max(image.width, image.height);
  const canvasSize = Math.max(MIN_GENERATION_SIZE, Math.min(MAX_GENERATION_SIZE, largestSide));
  const padding = canvasSize * 0.14;
  const drawableSize = canvasSize - padding * 2;
  const imageScale = Math.min(drawableSize / image.width, drawableSize / image.height, 1);
  const width = Math.max(1, Math.round(image.width * imageScale));
  const height = Math.max(1, Math.round(image.height * imageScale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = canvasSize;
  canvas.height = canvasSize;

  if (!context) return dataUrl;

  context.clearRect(0, 0, canvasSize, canvasSize);
  context.drawImage(
    image,
    Math.round((canvasSize - width) / 2),
    Math.round((canvasSize - height) / 2),
    width,
    height
  );

  return canvas.toDataURL('image/png');
}
