import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Vercel Blob SDK so we can assert what would be deleted without a store.
const del = vi.fn().mockResolvedValue(undefined);
const list = vi.fn();
const copy = vi.fn();
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: (...a: unknown[]) => list(...a),
  copy: (...a: unknown[]) => copy(...a),
}));

import {
  ownBlobHost,
  isOwnBlob,
  isUploadedBy,
  canAttachImage,
  deleteOwnBlob,
  deleteOwnBlobs,
  getUserUploadBytes,
  isSnapshotBlob,
  snapshotBlob,
  SNAPSHOT_COPY_TIMEOUT_MS,
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

  it('deleteOwnBlobs filters to only our blobs', async () => {
    await deleteOwnBlobs([OWN, EXTERNAL, null, OTHER_STORE, OWN]);
    expect(del).toHaveBeenCalledTimes(2);
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
