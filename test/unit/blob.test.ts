import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Vercel Blob SDK so we can assert what would be deleted without a store.
const del = vi.fn().mockResolvedValue(undefined);
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: (...a: unknown[]) => list(...a),
}));

import { isOwnBlob, deleteOwnBlob, deleteOwnBlobs, getUserUploadBytes } from '@/lib/utils/blob';

const OWN = 'https://abc123.public.blob.vercel-storage.com/uploads/u1/image-x.jpg';
const EXTERNAL = 'https://images.example.com/some/photo.jpg';

describe('isOwnBlob', () => {
  it('recognizes our Vercel Blob URLs', () => {
    expect(isOwnBlob(OWN)).toBe(true);
  });

  // regression: we must NEVER delete an externally-hosted image URL a user
  // pasted onto an item — only blobs we uploaded ourselves.
  it('rejects external, empty, and malformed URLs', () => {
    expect(isOwnBlob(EXTERNAL)).toBe(false);
    expect(isOwnBlob(null)).toBe(false);
    expect(isOwnBlob(undefined)).toBe(false);
    expect(isOwnBlob('')).toBe(false);
    expect(isOwnBlob('not a url')).toBe(false);
    // A lookalike host must not pass (suffix check is on the full hostname).
    expect(isOwnBlob('https://evil-blob.vercel-storage.com.attacker.com/x')).toBe(false);
  });
});

describe('deleteOwnBlob', () => {
  beforeEach(() => del.mockClear());

  it('deletes our own blob', async () => {
    await deleteOwnBlob(OWN);
    expect(del).toHaveBeenCalledWith(OWN);
  });

  it('never calls del for external or missing URLs', async () => {
    await deleteOwnBlob(EXTERNAL);
    await deleteOwnBlob(null);
    expect(del).not.toHaveBeenCalled();
  });

  it('swallows delete errors (best-effort cleanup must not throw)', async () => {
    del.mockRejectedValueOnce(new Error('network'));
    await expect(deleteOwnBlob(OWN)).resolves.toBeUndefined();
  });

  it('deleteOwnBlobs filters to only our blobs', async () => {
    await deleteOwnBlobs([OWN, EXTERNAL, null, OWN]);
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
