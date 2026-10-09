import { put } from '@vercel/blob';
import sharp from 'sharp';
import { getUserUploadBytes, USER_UPLOAD_QUOTA_BYTES } from '@/lib/utils/blob';
import {
  decodedAsDeclared,
  hasDeclaredSignature,
  restrictToUploadLoaders,
  sniffsAsSvg,
  type UploadImageType,
} from '@/lib/utils/uploadImageFormat';

/**
 * What every upload goes through once its bytes are in hand, whether a file
 * sent to `POST /api/upload` or an image fetched by `POST
 * /api/upload/from-url` (WIS-366): the signature and SVG checks, sharp's
 * re-encode, the per-user quota, and the blob under `uploads/<userId>/`.
 * Only the upload routes import it: it loads sharp, which ships with libvips
 * only where `outputFileTracingIncludes` says so.
 */

// sharp picks its decoder from the bytes, not from the type the client
// declared (WIS-157), so block every libvips loader but those of the formats
// accepted here, and SVG's. The block is process-wide, and next/og rasterizes
// every share card's SVG with sharp, so SVG's loader has to stay; `sniffsAsSvg`
// in `storeUploadImage` is what keeps uploads away from librsvg. Other sharp
// code that needs another loader has to be added to `UPLOAD_ROUTE_LOADERS`, or
// it fails wherever an upload route has loaded. Where Next's image optimizer
// runs in-process (`next start` / `next dev`, never on Vercel), its first use
// applies its own list, which adds TIFF; the checks don't rely on the block.
restrictToUploadLoaders(sharp);

// Max upload size. Vercel serverless functions cap the request body at ~4.5MB,
// so we validate a little under that.
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

// Re-encode an image with sharp to strip ALL metadata (EXIF/GPS/etc.) — sharp
// drops metadata unless explicitly asked to keep it, and `.rotate()` bakes in
// the EXIF orientation before that tag is discarded so the image still looks
// right. Returns the sanitized bytes and the output content type, or null when
// sharp's sniff finds the bytes aren't the declared type after all.
async function sanitizeImage(
  input: Buffer,
  type: UploadImageType
): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
  const animated = type === 'image/gif' || type === 'image/webp';
  // One instance for the sniff and the decode, so the header read runs under
  // the same limits as the decode (sharp's input pixel cap refuses an
  // oversized image right there, before any pixels are decoded).
  const base = sharp(input, { animated, failOn: 'none' });
  if (!decodedAsDeclared(type, await base.metadata())) return null;
  // Orientation only applies to still images; rotating an animation can break frames.
  const pipeline = animated ? base : base.rotate();

  switch (type) {
    case 'image/png':
      return { data: await pipeline.png().toBuffer(), contentType: 'image/png', ext: 'png' };
    case 'image/webp':
      return {
        data: await pipeline.webp({ quality: 82 }).toBuffer(),
        contentType: 'image/webp',
        ext: 'webp',
      };
    case 'image/avif':
      return {
        data: await pipeline.avif({ quality: 60 }).toBuffer(),
        contentType: 'image/avif',
        ext: 'avif',
      };
    case 'image/gif':
      return { data: await pipeline.gif().toBuffer(), contentType: 'image/gif', ext: 'gif' };
    case 'image/jpeg':
      return {
        data: await pipeline.jpeg({ quality: 85 }).toBuffer(),
        contentType: 'image/jpeg',
        ext: 'jpg',
      };
  }
}

export type StoreUploadResult =
  | { ok: true; url: string }
  /** Not what it says it is, or something librsvg would read. */
  | { ok: false; reason: 'unsupported' }
  /** sharp couldn't decode or re-encode it. */
  | { ok: false; reason: 'unprocessable' }
  /** It would take the user past their upload quota. */
  | { ok: false; reason: 'quota' };

/**
 * Re-encode `input` as `type` and store it in `userId`'s uploads folder.
 * The caller has checked the size (`UPLOAD_MAX_BYTES`) and that `type` is an
 * accepted one. A storage failure throws.
 */
export async function storeUploadImage(
  userId: string,
  input: Buffer,
  type: UploadImageType
): Promise<StoreUploadResult> {
  // The declared type only picks the encoder; the bytes pick the decoder.
  // Refuse anything that isn't what it says, or that libvips would hand to
  // librsvg, before sharp reads a byte of it.
  if (!hasDeclaredSignature(input, type) || sniffsAsSvg(input)) {
    return { ok: false, reason: 'unsupported' };
  }

  // Strip metadata before anything touches storage.
  let sanitized;
  try {
    sanitized = await sanitizeImage(input, type);
  } catch {
    return { ok: false, reason: 'unprocessable' };
  }
  if (!sanitized) return { ok: false, reason: 'unsupported' };

  // Per-user quota check against actual stored usage (self-healing, no counter drift).
  const used = await getUserUploadBytes(userId);
  if (used + sanitized.data.length > USER_UPLOAD_QUOTA_BYTES) {
    return { ok: false, reason: 'quota' };
  }

  const blob = await put(`uploads/${userId}/image.${sanitized.ext}`, sanitized.data, {
    access: 'public',
    addRandomSuffix: true,
    contentType: sanitized.contentType,
  });
  return { ok: true, url: blob.url };
}
