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
 * The hostname OUR Vercel Blob store serves public files from, or null when it
 * can't be determined.
 *
 * Derived from `BLOB_READ_WRITE_TOKEN`, shaped `vercel_blob_rw_<storeId>_<secret>`.
 * @vercel/blob reads the store ID the same way (the fourth `_`-separated field,
 * see `parseStoreIdFromReadWriteToken`) and builds public blob URLs as
 * `https://<storeId>.public.blob.vercel-storage.com/<pathname>` (see
 * `constructBlobUrl`). `new URL()` lowercases hostnames, so we lowercase the
 * store ID to compare.
 *
 * A missing or unparseable token yields null: then nothing counts as ours, so
 * nothing is ever deleted. This app authenticates the SDK with the RW token
 * (see README); if it ever moves to OIDC + `BLOB_STORE_ID`, derive the host from
 * that instead, or cleanup silently stops.
 */
export function ownBlobHost(
  token: string | undefined = process.env.BLOB_READ_WRITE_TOKEN
): string | null {
  const [vercel, blob, rw, storeId] = (token ?? '').trim().split('_');
  if (vercel !== 'vercel' || blob !== 'blob' || rw !== 'rw' || !storeId) return null;
  // It becomes a hostname label; anything else isn't a store ID we understand.
  if (!/^[a-z0-9-]+$/i.test(storeId)) return null;
  return `${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

/** Parse `url` if it points at our own store; null for anything else. */
function parseOwnBlobUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  const host = ownBlobHost();
  if (!host) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname === host ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Is this URL in OUR Vercel Blob store (as opposed to an external image URL a
 * user pasted in, or a file in some other Vercel Blob store)? We only ever
 * delete our own blobs, never an arbitrary remote URL that merely happens to be
 * stored on a record.
 */
export function isOwnBlob(url: string | null | undefined): url is string {
  return parseOwnBlobUrl(url) !== null;
}

/**
 * Is `parsed` (the parse of `raw`) a file directly inside `uploads/<userId>/`?
 * `/api/upload` puts every file there, so the path records the uploader.
 *
 * Checked strictly, so there's no gap between the URL we check and the string
 * we store and later hand to `del()`:
 *  - `raw` must already be in canonical form (what `put()` returns), so no `..`
 *    or `%2e%2e` segment is resolved away during the check;
 *  - the file name must be a single segment with no `%`, so no encoded `/` or
 *    `\` (`..%2F<otherId>/x.jpg`) can climb out if the store decodes it.
 */
function isInUploadFolder(parsed: URL, raw: string, userId: string): boolean {
  if (!userId || parsed.href !== raw) return false;
  const prefix = `/uploads/${userId}/`;
  return (
    parsed.pathname.startsWith(prefix) && /^[^/%]+$/.test(parsed.pathname.slice(prefix.length))
  );
}

/** Did `userId` upload this blob (a file in our store under `uploads/<userId>/`)? */
export function isUploadedBy(url: string | null | undefined, userId: string): boolean {
  if (!url) return false;
  const parsed = parseOwnBlobUrl(url);
  return !!parsed && isInUploadFolder(parsed, url, userId);
}

/**
 * May `actorId` store `next` in an image field (`User.image`,
 * `Wishlist.bannerUrl`, `Item.imageUrl`) that currently holds `current`?
 *
 * Every route that writes one of those fields must check this first. Whatever a
 * record holds is freed with `deleteOwnBlob` once it's replaced or the record is
 * deleted, so attaching another user's blob would let you delete their image.
 *
 * Allowed:
 *  - clearing the field;
 *  - keeping the value already on the record, so a co-owner can edit an item
 *    whose image another co-owner uploaded, and an owner can approve a
 *    proposal without dropping the proposer's image;
 *  - an external URL (anything outside our store), which we never delete;
 *  - a blob from the actor's own `uploads/<actorId>/` folder.
 *
 * Any other blob in our store is rejected.
 */
export function canAttachImage(
  next: string | null | undefined,
  actorId: string,
  current?: string | null
): boolean {
  if (!next || next === current) return true;
  const parsed = parseOwnBlobUrl(next);
  return !parsed || isInUploadFolder(parsed, next, actorId);
}

/** The 400 error for a write that fails `canAttachImage`. Shown in a toast. */
export const FOREIGN_IMAGE_ERROR =
  'You can only use images you uploaded yourself. Please upload your own copy.';

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
