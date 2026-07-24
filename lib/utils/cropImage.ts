export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Produces a cropped image Blob from a source (object) URL and a pixel crop
 * region. The output is capped at `maxWidth` to keep uploads small, and encoded
 * as WebP (falling back to PNG) so transparency is preserved.
 */
export async function getCroppedBlob(src: string, crop: PixelCrop, maxWidth = 1600): Promise<Blob> {
  const image = await loadImage(src);

  const scale = crop.width > maxWidth ? maxWidth / crop.width : 1;
  const outW = Math.round(crop.width * scale);
  const outH = Math.round(crop.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);

  const toBlob = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));

  const blob = (await toBlob('image/webp')) || (await toBlob('image/png'));
  if (!blob) throw new Error('Could not create image');
  return blob;
}
