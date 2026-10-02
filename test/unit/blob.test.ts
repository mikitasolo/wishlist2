import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Vercel Blob SDK so we can assert what would be deleted without a store.
const del = vi.fn().mockResolvedValue(undefined);
const list = vi.fn();
const copy = vi.fn();
const head = vi.fn();
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: (...a: unknown[]) => list(...a),
  copy: (...a: unknown[]) => copy(...a),
  head: (...a: unknown[]) => head(...a),
}));

import {
  ownBlobHost,
  isOwnBlob,
  isUploadedBy,
  canAttachImage,
  deleteOwnBlob,
  deleteOwnBlobs,
  isSameImage,
  freeReplacedImage,
  getUserUploadBytes,
  isSnapshotBlob,
  snapshotBlob,
  SNAPSHOT_COPY_TIMEOUT_MS,
  copyBlobToUploads,
  UPLOAD_COPY_TIMEOUT_MS,
  USER_UPLOAD_QUOTA_BYTES,
} from '@/lib/utils/blob';

// A fake read-write token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape.
// Mixed-case store ID on purpose: public URLs carry it lowercased.
const STORE_ID = 'TestStore42';
const TOKEN = ['vercel', 'blob', 'rw', STORE_ID, 'notasecret'].join('_');
const HOST = 'teststore42.public.blob.vercel-storage.com';

const OWN = `https://${HOST}/uploads/u1/image-x.jpg`;
const OTHER_USERS = `https://${HOST}/uploads/u2/image-y.jpg`;
const OTHER_STORE = 'https://otherstore9.public.blob.vercel-storage.com/uploads/u1/image-x.jpg';
const EXTERNAL = 'https://images.example.com/some/photo.jpg';

beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ownBlobHost', () => {
  it('derives our public store host from BLOB_READ_WRITE_TOKEN, lowercased', () => {
    expect(ownBlobHost()).toBe(HOST);
    expect(ownBlobHost(`  ${TOKEN}  `)).toBe(HOST);
  });

  it('is null for a missing or unparseable token', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(ownBlobHost()).toBeNull();
    expect(ownBlobHost(undefined)).toBeNull();
    expect(ownBlobHost('not-a-token')).toBeNull();
    expect(ownBlobHost('vercel_blob_rw_')).toBeNull(); // no store ID
    expect(ownBlobHost(['vercel', 'blob', 'client', STORE_ID, 'x'].join('_'))).toBeNull();
    expect(ownBlobHost(['vercel', 'blob', 'rw', 'evil.com/', 'x'].join('_'))).toBeNull();
  });
});

describe('isOwnBlob', () => {
  it('recognizes URLs in our own store', () => {
    expect(isOwnBlob(OWN)).toBe(true);
    expect(isOwnBlob(OTHER_USERS)).toBe(true); // still our store (see isUploadedBy)
  });

  // regression: the check used to accept any *.blob.vercel-storage.com host,
  // i.e. every Vercel Blob store, not just ours.
  it('regression: rejects another Vercel Blob store', () => {
    expect(isOwnBlob(OTHER_STORE)).toBe(false);
    expect(isOwnBlob(`https://teststore42.private.blob.vercel-storage.com/uploads/u1/x.jpg`)).toBe(
      false
    );
  });

  // regression: we must NEVER delete an externally-hosted image URL a user
  // pasted onto an item — only blobs we uploaded ourselves.
  it('rejects external, empty, and malformed URLs', () => {
    expect(isOwnBlob(EXTERNAL)).toBe(false);
    expect(isOwnBlob(null)).toBe(false);
    expect(isOwnBlob(undefined)).toBe(false);
    expect(isOwnBlob('')).toBe(false);
    expect(isOwnBlob('not a url')).toBe(false);
    // Lookalike hosts must not pass.
    expect(isOwnBlob(`https://${HOST}.attacker.com/uploads/u1/x.jpg`)).toBe(false);
    expect(isOwnBlob(`https://evil${HOST}/uploads/u1/x.jpg`)).toBe(false);
  });

  it('treats nothing as ours when the token is missing', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(isOwnBlob(OWN)).toBe(false);
  });
});

describe('isUploadedBy', () => {
  it('accepts a blob in the user’s own uploads folder', () => {
    expect(isUploadedBy(OWN, 'u1')).toBe(true);
  });

  it('rejects another user’s folder, including prefix lookalikes', () => {
    expect(isUploadedBy(OTHER_USERS, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1x/image.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1`, 'u1')).toBe(false);
  });

  it('rejects paths that climb out of the folder', () => {
    expect(isUploadedBy(`https://${HOST}/uploads/u1/../u2/image.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1/%2e%2e/u2/image.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1%2F..%2Fu2/image.jpg`, 'u1')).toBe(false);
    // Starts with uploads/u1/, but the store might decode %2F on delete.
    expect(isUploadedBy(`https://${HOST}/uploads/u1/..%2Fu2%2Fimage.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1/..%5Cu2%5Cimage.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1/nested/image.jpg`, 'u1')).toBe(false);
  });

  it('only accepts the canonical URL (the exact string that gets stored and deleted)', () => {
    // Dot segments that resolve back into the user's own folder still don't pass.
    expect(isUploadedBy(`https://${HOST}/uploads/u2/../u1/image.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(`https://${HOST}/uploads/u1/./image.jpg`, 'u1')).toBe(false);
    expect(
      isUploadedBy(`https://TestStore42.public.blob.vercel-storage.com/uploads/u1/x.jpg`, 'u1')
    ).toBe(false);
  });

  it('rejects blobs outside uploads/, other stores, external and malformed URLs', () => {
    expect(isUploadedBy(`https://${HOST}/u1/image.jpg`, 'u1')).toBe(false);
    expect(isUploadedBy(OTHER_STORE, 'u1')).toBe(false);
    expect(isUploadedBy(EXTERNAL, 'u1')).toBe(false);
    expect(isUploadedBy('not a url', 'u1')).toBe(false);
    expect(isUploadedBy(null, 'u1')).toBe(false);
    expect(isUploadedBy(OWN, '')).toBe(false);
  });

  it('is false for everything when the token is missing', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(isUploadedBy(OWN, 'u1')).toBe(false);
  });
});

describe('canAttachImage', () => {
  it('allows the actor’s own upload', () => {
    expect(canAttachImage(OWN, 'u1')).toBe(true);
  });

  // regression: image fields accepted any URL, and isOwnBlob matched every
  // user's folder, so attaching someone else's blob and then clearing it
  // deleted their image.
  it('regression: rejects a blob from another user’s folder', () => {
    expect(canAttachImage(OTHER_USERS, 'u1')).toBe(false);
    expect(canAttachImage(OTHER_USERS, 'u1', OWN)).toBe(false);
    expect(canAttachImage(`https://${HOST}/elsewhere/image.jpg`, 'u1')).toBe(false);
    expect(canAttachImage(`https://${HOST}/uploads/u1/..%2Fu2%2Fimage-y.jpg`, 'u1')).toBe(false);
  });

  it('allows keeping the value already on the record, whoever uploaded it', () => {
    expect(canAttachImage(OTHER_USERS, 'u1', OTHER_USERS)).toBe(true);
  });

  it('allows clearing the field', () => {
    expect(canAttachImage(null, 'u1', OTHER_USERS)).toBe(true);
    expect(canAttachImage('', 'u1', OTHER_USERS)).toBe(true);
    expect(canAttachImage(undefined, 'u1')).toBe(true);
  });

  it('allows URLs outside our store (we never delete those)', () => {
    expect(canAttachImage(EXTERNAL, 'u1')).toBe(true);
    expect(canAttachImage(OTHER_STORE, 'u1')).toBe(true);
    expect(canAttachImage('not a url', 'u1')).toBe(true); // Zod rejects it first
  });

  it('allows anything when the token is missing, since then nothing is ever deleted', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(canAttachImage(OTHER_USERS, 'u1')).toBe(true);
  });
});

describe('deleteOwnBlob', () => {
  beforeEach(() => del.mockClear());

  it('deletes our own blob', async () => {
    await deleteOwnBlob(OWN);
    expect(del).toHaveBeenCalledWith(OWN);
  });

  it('never calls del for external, other-store, or missing URLs', async () => {
    await deleteOwnBlob(EXTERNAL);
    await deleteOwnBlob(OTHER_STORE);
    await deleteOwnBlob(null);
    expect(del).not.toHaveBeenCalled();
  });

  it('never calls del when the token is missing', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    await deleteOwnBlob(OWN);
    expect(del).not.toHaveBeenCalled();
  });

  it('swallows delete errors (best-effort cleanup must not throw)', async () => {
    del.mockRejectedValueOnce(new Error('network'));
    await expect(deleteOwnBlob(OWN)).resolves.toBeUndefined();
  });

  // regression: a failed delete logged the whole URL, and its `uploads/<userId>/`
  // folder put the uploader's user id in the server log.
  it('regression: logs a failed delete without the uploader’s user id', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = `https://${HOST}/uploads/64b7f0c2a1b2c3d4e5f60718/image-AbC123.jpg`;
    del.mockRejectedValueOnce(new Error('network'));

    await deleteOwnBlob(url);

    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = errorLog.mock.calls[0]!.map(String).join(' ');
    expect(logged).not.toContain('64b7f0c2a1b2c3d4e5f60718');
    // Still enough to find the blob that was left behind.
    expect(logged).toContain(`https://${HOST}/uploads/<user>/image-AbC123.jpg`);
    errorLog.mockRestore();
  });

  it('deleteOwnBlobs filters to only our blobs', async () => {
    await deleteOwnBlobs([OWN, EXTERNAL, null, OTHER_STORE, OWN]);
    expect(del).toHaveBeenCalledTimes(2);
  });
});

describe('isSameImage', () => {
  it('compares URLs, with an empty one and none at all both meaning no image', () => {
    expect(isSameImage(OWN, OWN)).toBe(true);
    expect(isSameImage(OWN, OTHER_USERS)).toBe(false);
    expect(isSameImage(OWN, null)).toBe(false);
    expect(isSameImage('', null)).toBe(true);
    expect(isSameImage(undefined, null)).toBe(true);
    expect(isSameImage('', OWN)).toBe(false);
  });
});

describe('freeReplacedImage', () => {
  beforeEach(() => del.mockClear());

  it('frees our own blob the write replaced, or cleared', async () => {
    await freeReplacedImage(OWN, OTHER_USERS);
    await freeReplacedImage(OWN, null);
    expect(del.mock.calls).toEqual([[OWN], [OWN]]);
  });

  it('frees nothing when the write left the image as it was', async () => {
    await freeReplacedImage(OWN, OWN);
    await freeReplacedImage(null, '');
    expect(del).not.toHaveBeenCalled();
  });

  it('never frees an external or other-store image it replaced', async () => {
    await freeReplacedImage(EXTERNAL, OWN);
    await freeReplacedImage(OTHER_STORE, null);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('getUserUploadBytes', () => {
  beforeEach(() => list.mockReset());

  it('sums sizes across paginated results', async () => {
    list
      .mockResolvedValueOnce({ blobs: [{ size: 100 }, { size: 250 }], cursor: 'next' })
      .mockResolvedValueOnce({ blobs: [{ size: 50 }], cursor: undefined });
    expect(await getUserUploadBytes('u1')).toBe(400);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toMatchObject({ prefix: 'uploads/u1/' });
  });
});

const SNAPSHOT = `https://${HOST}/snapshots/0b7d6f5e-2c1a-4e8b-9f3d-5a6b7c8d9e0f.jpg`;

describe('isSnapshotBlob', () => {
  it('recognizes a file directly inside our snapshots/ folder', () => {
    expect(isSnapshotBlob(SNAPSHOT)).toBe(true);
  });

  it('rejects uploads, other stores, external, lookalike and malformed URLs', () => {
    expect(isSnapshotBlob(OWN)).toBe(false);
    expect(
      isSnapshotBlob(`https://otherstore9.public.blob.vercel-storage.com/snapshots/x.jpg`)
    ).toBe(false);
    expect(isSnapshotBlob(EXTERNAL)).toBe(false);
    expect(isSnapshotBlob(`https://${HOST}/snapshotsx/x.jpg`)).toBe(false);
    expect(isSnapshotBlob(`https://${HOST}/snapshots/nested/x.jpg`)).toBe(false);
    expect(isSnapshotBlob(`https://${HOST}/snapshots/..%2Fuploads%2Fu1%2Fx.jpg`)).toBe(false);
    expect(isSnapshotBlob(`https://${HOST}/snapshots/../uploads/u1/x.jpg`)).toBe(false);
    expect(isSnapshotBlob(`https://${HOST}/snapshots/`)).toBe(false);
    expect(isSnapshotBlob(null)).toBe(false);
    expect(isSnapshotBlob('not a url')).toBe(false);
  });

  it('is false when the token is missing', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(isSnapshotBlob(SNAPSHOT)).toBe(false);
  });

  // A snapshot is freed when its reservation ends, so nobody may attach one to
  // an image field (and later get it freed from under the gifter).
  it('can never be attached to an image field', () => {
    expect(canAttachImage(SNAPSHOT, 'u1')).toBe(false);
    expect(canAttachImage(SNAPSHOT, 'u1', OWN)).toBe(false);
  });
});

describe('snapshotBlob', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    copy.mockReset();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorLog.mockRestore();
    vi.useRealTimers();
  });

  it('copies our own blob to a random name in snapshots/, keeping the extension', async () => {
    copy.mockImplementation(async (_from: string, to: string) => ({
      url: `https://${HOST}/${to}`,
    }));

    const first = await snapshotBlob(OWN);
    const second = await snapshotBlob(OWN);

    expect(copy).toHaveBeenCalledTimes(2);
    const [from, to, options] = copy.mock.calls[0];
    expect(from).toBe(OWN);
    expect(to).toMatch(/^snapshots\/[0-9a-f-]{36}\.jpg$/);
    expect(options).toMatchObject({ access: 'public' });
    expect(first).toBe(`https://${HOST}/${to}`);
    expect(isSnapshotBlob(first)).toBe(true);
    expect(second).not.toBe(first); // unguessable, and never shared between bookings
  });

  it('returns an external or empty URL as-is, without copying', async () => {
    expect(await snapshotBlob(EXTERNAL)).toBe(EXTERNAL);
    expect(await snapshotBlob(OTHER_STORE)).toBe(OTHER_STORE);
    expect(await snapshotBlob(null)).toBeNull();
    expect(await snapshotBlob('')).toBeNull();
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back to the original URL when the copy fails, logging neither URL', async () => {
    copy.mockRejectedValueOnce(new Error('The blob service is currently not available.'));

    expect(await snapshotBlob(OWN)).toBe(OWN);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = errorLog.mock.calls[0].join(' ');
    expect(logged).not.toContain(HOST);
    expect(logged).not.toContain('u1');
  });

  it('gives up after the timeout, aborting the copy, and keeps the original URL', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    copy.mockImplementationOnce(
      (_from: string, _to: string, options: { abortSignal: AbortSignal }) => {
        signal = options.abortSignal;
        return new Promise(() => {}); // a store that never answers
      }
    );

    const pending = snapshotBlob(OWN);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_COPY_TIMEOUT_MS);

    expect(await pending).toBe(OWN);
    expect(signal?.aborted).toBe(true);
  });
});

describe('copyBlobToUploads', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    copy.mockReset();
    head.mockReset();
    list.mockReset();
    del.mockClear();
    head.mockResolvedValue({ size: 1000 });
    list.mockResolvedValue({ blobs: [{ size: 5000 }], cursor: undefined });
    // The SDK adds a random suffix before the extension.
    copy.mockImplementation(async (_from: string, to: string) => ({
      url: `https://${HOST}/${to.replace(/(\.[a-z]+)$/, '-Xy12$1')}`,
    }));
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorLog.mockRestore();
    vi.useRealTimers();
  });

  it("copies our blob into the user's own uploads folder, keeping the extension", async () => {
    const result = await copyBlobToUploads(OTHER_USERS, 'u1');

    expect(copy).toHaveBeenCalledWith(
      OTHER_USERS,
      'uploads/u1/image.jpg',
      expect.objectContaining({ access: 'public', addRandomSuffix: true })
    );
    expect(result).toEqual({ ok: true, url: `https://${HOST}/uploads/u1/image-Xy12.jpg` });
    if (!result.ok) throw new Error('expected a copy');
    // One the user may attach, as their own upload.
    expect(isUploadedBy(result.url, 'u1')).toBe(true);
    expect(canAttachImage(result.url, 'u1')).toBe(true);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'uploads/u1/' }));
    expect(head).toHaveBeenCalledWith(OTHER_USERS, expect.anything());
  });

  it('gives up after the timeout, aborting, and frees a copy that lands later', async () => {
    vi.useFakeTimers();
    let land: (value: { url: string }) => void = () => {};
    let signal: AbortSignal | undefined;
    copy.mockImplementationOnce(
      (_from: string, _to: string, options: { abortSignal: AbortSignal }) => {
        signal = options.abortSignal;
        return new Promise((resolve) => (land = resolve)); // a store that's slow to answer
      }
    );

    const pending = copyBlobToUploads(OTHER_USERS, 'u1');
    await vi.advanceTimersByTimeAsync(UPLOAD_COPY_TIMEOUT_MS);

    expect(await pending).toEqual({ ok: false, reason: 'failed' });
    expect(signal?.aborted).toBe(true);
    expect(del).not.toHaveBeenCalled();

    const late = `https://${HOST}/uploads/u1/image-late.jpg`;
    land({ url: late });
    await vi.runAllTimersAsync();
    expect(del).toHaveBeenCalledWith(late);
    vi.useRealTimers();
  });

  it("doesn't start the copy once the size checks have run past the timeout", async () => {
    vi.useFakeTimers();
    let sized: (value: { size: number }) => void = () => {};
    head.mockImplementationOnce(() => new Promise((resolve) => (sized = resolve)));

    const pending = copyBlobToUploads(OTHER_USERS, 'u1');
    await vi.advanceTimersByTimeAsync(UPLOAD_COPY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: 'failed' });

    sized({ size: 1000 });
    await vi.runAllTimersAsync();
    expect(copy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("refuses with 'quota' when the copy wouldn't fit, without copying", async () => {
    list.mockResolvedValue({ blobs: [{ size: USER_UPLOAD_QUOTA_BYTES - 999 }], cursor: undefined });

    expect(await copyBlobToUploads(OTHER_USERS, 'u1')).toEqual({ ok: false, reason: 'quota' });
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies when it just fits', async () => {
    list.mockResolvedValue({
      blobs: [{ size: USER_UPLOAD_QUOTA_BYTES - 1000 }],
      cursor: undefined,
    });

    expect((await copyBlobToUploads(OTHER_USERS, 'u1')).ok).toBe(true);
  });

  it("fails without touching the store for anything that isn't our blob", async () => {
    for (const url of [EXTERNAL, OTHER_STORE, 'not a url']) {
      expect(await copyBlobToUploads(url, 'u1')).toEqual({ ok: false, reason: 'failed' });
    }
    expect(await copyBlobToUploads(OWN, '')).toEqual({ ok: false, reason: 'failed' });
    expect(head).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it('fails, logging neither URL nor user, when the store does', async () => {
    copy.mockRejectedValueOnce(new Error('The blob service is currently not available.'));
    expect(await copyBlobToUploads(OTHER_USERS, 'u1')).toEqual({ ok: false, reason: 'failed' });

    head.mockRejectedValueOnce(new Error('The requested blob does not exist'));
    expect(await copyBlobToUploads(OTHER_USERS, 'u1')).toEqual({ ok: false, reason: 'failed' });

    expect(errorLog).toHaveBeenCalledTimes(2);
    const logged = errorLog.mock.calls.flat().join(' ');
    expect(logged).not.toContain(HOST);
    expect(logged).not.toContain('u1');
    expect(logged).not.toContain('u2');
  });

  it("drops a copy that didn't land directly in the user's folder", async () => {
    const stray = `https://${HOST}/uploads/u1/nested/image.jpg`;
    copy.mockResolvedValueOnce({ url: stray });

    expect(await copyBlobToUploads(OTHER_USERS, 'u1')).toEqual({ ok: false, reason: 'failed' });
    expect(del).toHaveBeenCalledWith(stray);
  });
});
