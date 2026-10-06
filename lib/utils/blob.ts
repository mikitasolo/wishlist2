import { randomUUID } from 'node:crypto';
import { copy, del, head, list } from '@vercel/blob';

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
  return !!userId && isDirectlyIn(parsed, raw, `/uploads/${userId}/`);
}

/** The strict check behind `isInUploadFolder`, for any folder `prefix` (`/…/`). */
function isDirectlyIn(parsed: URL, raw: string, prefix: string): boolean {
  if (parsed.href !== raw) return false;
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
    // Masked: an `uploads/<userId>/` folder names the uploader. The file name,
    // random-suffixed on upload, still identifies the blob left behind.
    console.error(
      'Blob cleanup failed for',
      url.replace(/\/uploads\/[^/]+\//, '/uploads/<user>/'),
      err
    );
  }
}

/** Delete many blobs, skipping any that aren't ours. Best-effort. */
export async function deleteOwnBlobs(urls: Array<string | null | undefined>): Promise<void> {
  await Promise.all(urls.map(deleteOwnBlob));
}

/** Are these the same image? An empty URL and none at all both mean no image. */
export function isSameImage(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || null) === (b || null);
}

/**
 * Free the image an edit's write replaced in an image field (`User.image`,
 * `Wishlist.bannerUrl`, `Item.imageUrl`), if it was one of ours.
 *
 * `replaced` is the field's value in the document the write itself handed back
 * from just before it landed (`returnDocument: 'before'`), and `written` the
 * value it wrote. Never the value the request read earlier: two owners
 * replacing the same image at once both read A, and the first write frees A.
 * The second replaced the first's B, which nothing else would free (it'd be
 * orphaned in storage, on its uploader's quota), and freeing A again instead
 * frees whatever A is by then. A write that leaves the image as it was frees
 * nothing. So does one that doesn't write the field at all, which is how a
 * route should treat an edit that sends the image the field already holds
 * (`isSameImage`): written back, it could restore one a concurrent edit has
 * just replaced and freed, leaving the record pointing at a deleted blob.
 */
export async function freeReplacedImage(
  replaced: string | null | undefined,
  written: string | null | undefined
): Promise<void> {
  if (!isSameImage(replaced, written)) await deleteOwnBlob(replaced);
}

/**
 * Snapshot blobs: our own copies of item images, frozen onto a `Reservation`
 * (and the `GiftLog` it turns into) when the item is booked.
 *
 * The reservation's image has to outlive the item's. The owner deleting the item
 * or replacing its image frees the item's blob, which would leave the gifter
 * with a broken image, so booking stores a copy instead of the item's URL.
 *
 * Snapshots live outside every `uploads/<id>/` folder. So they count against
 * nobody's upload quota (least of all the owner's: owners are booking-blind, and
 * a quota that grew whenever someone booked would tell them), and
 * `canAttachImage` never lets anyone put one into an image field. File names
 * are random UUIDs, so a snapshot's URL can't be guessed.
 */
const SNAPSHOT_FOLDER = 'snapshots/';

/** How long booking waits for a snapshot copy before keeping the original URL. */
export const SNAPSHOT_COPY_TIMEOUT_MS = 3000;

/** Is this one of our snapshot blobs (a file directly inside `snapshots/`)? */
export function isSnapshotBlob(url: string | null | undefined): url is string {
  if (!url) return false;
  const parsed = parseOwnBlobUrl(url);
  return !!parsed && isDirectlyIn(parsed, url, `/${SNAPSHOT_FOLDER}`);
}

/**
 * The image URL to freeze onto a new reservation: a fresh snapshot copy of
 * `url` when it's one of our blobs, or `url` itself when it's external (we never
 * delete those, so there's nothing to protect) or empty.
 *
 * Best-effort and time-boxed, because a booking must never fail or hang over a
 * copy. On any error, or after `SNAPSHOT_COPY_TIMEOUT_MS`, it gives up and
 * returns `url`, sharing the item's blob as bookings did before snapshots;
 * `/booked` shows a placeholder if that blob is freed later. The log line
 * carries neither URL, since the source path names the list's owner.
 */
export async function snapshotBlob(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const parsed = parseOwnBlobUrl(url);
  if (!parsed) return url;

  try {
    const copied = await withTimeout(SNAPSHOT_COPY_TIMEOUT_MS, (abortSignal) =>
      copy(url, `${SNAPSHOT_FOLDER}${randomUUID()}${extensionOf(parsed)}`, {
        access: 'public',
        abortSignal,
      })
    );
    return copied.url;
  } catch (err) {
    console.error(`Snapshot copy failed, keeping the original image URL (${errorReason(err)})`);
    return url;
  }
}

/** A copy keeps its source's extension: the store derives its content type from it. */
function extensionOf(parsed: URL): string {
  return /\.[a-z0-9]{1,8}$/i.exec(parsed.pathname)?.[0] ?? '';
}

/** An error's name and message, for a log line that mustn't carry a URL of ours. */
function errorReason(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
}

/**
 * `work`, given up on after `ms`: rejects then, and aborts the signal `work` was
 * handed. Raced against a timer rather than just giving `work` an
 * `AbortSignal.timeout`: the SDK retries a failing request with growing backoff,
 * and an abort only lands on the next attempt, so the signal alone doesn't bound
 * the wait. A request under way at the timeout may still complete after it.
 */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Every blob under a user's `uploads/<id>/` folder, for erasing them with their
 * account. Nothing without our own store (local dev, CI): then there's nothing
 * of ours to free. A failed listing throws, so the account deletion stops before
 * the account goes and can be finished by running it again.
 */
export async function listUserUploads(userId: string): Promise<string[]> {
  if (!ownBlobHost() || !userId) return [];
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: `uploads/${userId}/`, cursor, limit: 1000 });
    for (const b of res.blobs) if (isUploadedBy(b.url, userId)) urls.push(b.url);
    cursor = res.cursor;
  } while (cursor);
  return urls;
}

/** What `copyBlobToUploads` made: the copy's URL, or why there is none. */
export type UploadCopy = { ok: true; url: string } | { ok: false; reason: 'quota' | 'failed' };

/** A user's upload bytes, shared by copies made together (see `copyBlobToUploads`). */
export interface UploadBudget {
  used: number;
}

/** How long saving a copy of an item waits for its image copy before saving without it. */
export const UPLOAD_COPY_TIMEOUT_MS = 5000;

/**
 * Copy one of our blobs into `uploads/<userId>/` as that user's own file. Used
 * when they save a copy of an item ("Save to my list"): the source and the copy
 * must never share a blob, because deleting either item frees its image, which
 * would break the other's.
 *
 * The copy is the user's like any upload of theirs: it counts against their
 * `USER_UPLOAD_QUOTA_BYTES`, so it isn't made when it wouldn't fit (`quota`),
 * and it's one `canAttachImage` accepts from them. It needs no `sharp` pass,
 * as the source was sanitized when it was uploaded.
 *
 * Never throws, and gives up after `UPLOAD_COPY_TIMEOUT_MS`: anything else that
 * goes wrong is `failed`, and the caller saves the item without an image (a
 * copy that lands after the timeout is freed then). `url` must be one of our
 * blobs (`isOwnBlob`); anything else is `failed` too. Its own log lines carry
 * no URL, since a blob's path names the user who uploaded it.
 *
 * Several copies made at once (starting a new list from one, WIS-325) share
 * one `budget`: the user's upload bytes, read once by the caller. Each copy
 * checks it and reserves its size in one step before copying (and gives it
 * back if the copy doesn't stand), so copies running together can't go over
 * the quota between them, and the folder is listed once, not per image.
 */
export async function copyBlobToUploads(
  url: string,
  userId: string,
  budget?: UploadBudget
): Promise<UploadCopy> {
  const parsed = parseOwnBlobUrl(url);
  if (!parsed || !userId) return { ok: false, reason: 'failed' };
  const started: { copy?: Promise<{ url: string }> } = {};
  let reserved = 0;
  const release = () => {
    if (budget) budget.used -= reserved;
    reserved = 0;
  };
  try {
    const copied = await withTimeout(UPLOAD_COPY_TIMEOUT_MS, async (abortSignal) => {
      const [source, used] = await Promise.all([
        head(url, { abortSignal }),
        budget ? budget.used : getUserUploadBytes(userId),
      ]);
      // Checked and reserved with no await between, against the budget as it
      // is now (others may have reserved since it was read above).
      if ((budget ? budget.used : used) + source.size > USER_UPLOAD_QUOTA_BYTES) return null;
      abortSignal.throwIfAborted(); // too late: don't start a copy nobody will keep
      if (budget) {
        reserved = source.size;
        budget.used += reserved;
      }
      started.copy = copy(url, `uploads/${userId}/image${extensionOf(parsed)}`, {
        access: 'public',
        addRandomSuffix: true,
        abortSignal,
      });
      return started.copy;
    });
    if (!copied) return { ok: false, reason: 'quota' };
    if (isUploadedBy(copied.url, userId)) return { ok: true, url: copied.url };
    // Not a file directly in their folder, so not one they could keep: drop it.
    release();
    await deleteOwnBlob(copied.url);
    console.error('Copying an image into uploads gave a path outside the folder; dropped it');
  } catch (err) {
    // A copy still under way at the timeout may land later, in their folder and
    // on their quota, with nothing holding it: free it then.
    release();
    started.copy?.then(
      (late) => deleteOwnBlob(late.url),
      () => {}
    );
    console.error(`Copying an image into uploads failed (${errorReason(err)})`);
  }
  return { ok: false, reason: 'failed' };
}
