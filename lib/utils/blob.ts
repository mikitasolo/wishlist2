import { del, list } from '@vercel/blob';

/**
 * Per-user upload quota. Generous on purpose: images are re-encoded on upload
 * (usually well under 1MB each) and replacing an image frees the old one, so a
 * normal user never approaches this even with a few hundred items across their
 * wishlists. It exists to stop one account from uploading thousands of distinct
 * files and running up storage cost.
 */
export const USER_UPLOAD_QUOTA_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Is this URL one of OUR Vercel Blob uploads (as opposed to an external image
 * URL a user pasted in)? We only ever delete our own blobs — never an
 * arbitrary remote URL that merely happens to be stored on an item.
 */
export function isOwnBlob(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

/**
 * Delete a blob if — and only if — it's one of ours. Best-effort: a failed
 * cleanup must never fail the user-facing action that triggered it, so this
 * swallows errors (logging them) rather than throwing.
 */
export async function deleteOwnBlob(url: string | null | undefined): Promise<void> {
  if (!isOwnBlob(url)) return;
  try {
    await del(url);
  } catch (err) {
    console.error('Blob cleanup failed for', url, err);
  }
}

/** Delete many blobs, skipping any that aren't ours. Best-effort. */
export async function deleteOwnBlobs(urls: Array<string | null | undefined>): Promise<void> {
  await Promise.all(urls.map(deleteOwnBlob));
}

/**
 * Total bytes a user currently occupies under their `uploads/<id>/` prefix.
 * Authoritative (reads the store directly) so it can't drift the way a cached
 * counter would; delete-on-replace keeps the real number naturally low.
 */
export async function getUserUploadBytes(userId: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: `uploads/${userId}/`, cursor, limit: 1000 });
    for (const b of res.blobs) total += b.size;
    cursor = res.cursor;
  } while (cursor);
  return total;
}
