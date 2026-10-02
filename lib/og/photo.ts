import { isOwnBlob } from '@/lib/utils/blob';
import { errorKind } from '@/lib/utils/errorKind';
import { withTimeout } from '@/lib/utils/og';

/**
 * A photo for a share card (a list's banner, a user's avatar), as next/og can
 * draw it:
 *
 *  - `none`: there's no image, or it isn't one of ours. The card draws its
 *    gradient, and that's a real answer the CDN may keep.
 *  - `failed`: it's ours but couldn't be loaded in time. The card still draws its
 *    gradient, but isn't cached, so the next fetch tries the photo again.
 *  - `ok`: a JPEG data URI, already cropped to the size the card draws it at.
 */
export type CardPhoto = { status: 'none' } | { status: 'failed' } | { status: 'ok'; src: string };

/** Uploads are capped at 4 MB (app/api/upload); anything bigger isn't ours. */
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
/** The whole photo (fetch and convert) gets this long before the card gives up on it. */
export const PHOTO_BUDGET_MS = 2500;

/**
 * Load `url` for a card, cropped to `box`. Only a blob in our own store is ever
 * fetched (`isOwnBlob`): a banner or avatar can be any URL a user pasted, and
 * fetching that from the server would let anyone make it request an address of
 * their choosing. Our uploads are mostly WebP (or AVIF), which next/og can't
 * draw, so sharp re-encodes it as a JPEG.
 */
export async function loadCardPhoto(
  url: string | null | undefined,
  box: { width: number; height: number }
): Promise<CardPhoto> {
  if (!isOwnBlob(url)) return { status: 'none' };
  try {
    return { status: 'ok', src: await withTimeout(fetchAsJpeg(url, box), PHOTO_BUDGET_MS) };
  } catch (err) {
    // Never the URL: its path carries the uploader's user id.
    console.error('Share card photo failed, drawing the gradient instead:', errorKind(err));
    return { status: 'failed' };
  }
}

async function fetchAsJpeg(url: string, box: { width: number; height: number }): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_BUDGET_MS), redirect: 'error' });
  // A body that's refused is cancelled, so it doesn't hold its connection.
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new Error(`photo-http-${res.status}`);
  }
  if (Number(res.headers.get('content-length')) > PHOTO_MAX_BYTES) {
    await res.body.cancel();
    throw new Error('photo-too-large');
  }
  const bytes = await readAtMost(res.body, PHOTO_MAX_BYTES);

  // Loaded here, not at the top of the module, so a sharp that can't load
  // (WIS-156) costs the card its photo, never the card.
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp(bytes, { animated: false })
    .resize(box.width, box.height, { fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** The whole body, or a throw once it passes `max` bytes (a missing or lying length). */
async function readAtMost(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('photo-too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
