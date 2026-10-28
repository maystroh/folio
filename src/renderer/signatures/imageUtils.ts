export interface SignatureProcessingOptions {
  cleanBackground: boolean;
  threshold: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  trim: boolean;
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The signature image could not be loaded.'));
    image.src = source;
  });
}

export function trimCanvas(canvas: HTMLCanvasElement, padding = 10): HTMLCanvasElement {
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return canvas;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + padding + 1);
  const bottom = Math.min(height, maxY + padding + 1);
  const trimmed = document.createElement('canvas');
  trimmed.width = right - left;
  trimmed.height = bottom - top;
  const trimmedContext = trimmed.getContext('2d');
  if (!trimmedContext) return canvas;
  trimmedContext.drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  return trimmed;
}

export async function prepareSignatureImage(
  source: string,
  options: SignatureProcessingOptions,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await loadImage(source);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Signature processing is unavailable.');
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);

  const imageData = context.getImageData(0, 0, sourceWidth, sourceHeight);
  const pixels = imageData.data;
  const threshold = options.cleanBackground ? options.threshold : 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const alpha = pixels[index + 3] / 255;
    if (options.cleanBackground) {
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const darkness = Math.max(0, threshold - luminance);
      const inkAlpha = Math.min(1, darkness / 42) * alpha;
      pixels[index + 3] = Math.round(inkAlpha * 255);
      if (inkAlpha > 0) {
        const lift = 0.74;
        pixels[index] = Math.round(r * lift);
        pixels[index + 1] = Math.round(g * lift);
        pixels[index + 2] = Math.round(b * lift);
      }
    }
  }
  context.putImageData(imageData, 0, 0);

  if (options.flipHorizontal || options.flipVertical) {
    const flipped = document.createElement('canvas');
    flipped.width = canvas.width;
    flipped.height = canvas.height;
    const flippedContext = flipped.getContext('2d');
    if (!flippedContext) throw new Error('Signature processing is unavailable.');
    flippedContext.translate(
      options.flipHorizontal ? canvas.width : 0,
      options.flipVertical ? canvas.height : 0,
    );
    flippedContext.scale(options.flipHorizontal ? -1 : 1, options.flipVertical ? -1 : 1);
    flippedContext.drawImage(canvas, 0, 0);
    canvas.width = flipped.width;
    canvas.height = flipped.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(flipped, 0, 0);
  }

  let output = canvas;
  if (options.trim) output = trimCanvas(canvas, Math.round(Math.min(canvas.width, canvas.height) * 0.015) + 6);

  return { dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height };
}

export function canvasToSignature(canvas: HTMLCanvasElement): { dataUrl: string; width: number; height: number } {
  const trimmed = trimCanvas(canvas, 12);
  return { dataUrl: trimmed.toDataURL('image/png'), width: trimmed.width, height: trimmed.height };
}
