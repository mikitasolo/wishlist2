import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// DELETE /api/upload (WIS-181): the browser gives back an upload no form saved.
// It may only ever free a file in the caller's own uploads folder that no record
// shows, and it answers the same whether or not it freed it.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Record what would be deleted instead of talking to a store.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
  head: vi.fn(),
  copy: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { DELETE } from '@/app/api/upload/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { releaseUnsavedUpload } from '@/lib/utils/unsavedUploads';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

const session = vi.mocked(auth);
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const ALICE = new mongoose.Types.ObjectId().toString();
const BOB = new mongoose.Types.ObjectId().toString();
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;
const OK = { success: true };

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __setRateLimiters(null);
});

function as(userId: string | null) {
  session.mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
}

function release(body: unknown) {
  return DELETE(
    new NextRequest('http://localhost/api/upload', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

/** The release answered as it does for any URL of the caller's, and freed nothing. */
async function expectKept(res: Response) {
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(OK);
  expect(del).not.toHaveBeenCalled();
}

describe('DELETE /api/upload', () => {
  it('refuses a signed-out caller and frees nothing', async () => {
    as(null);
    const res = await release({ url: blobOf(ALICE) });
    expect(res.status).toBe(401);
    expect(del).not.toHaveBeenCalled();
  });

  it('frees an upload of the caller that nothing shows', async () => {
    as(ALICE);
    const res = await release({ url: blobOf(ALICE) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK);
    expect(del).toHaveBeenCalledWith(blobOf(ALICE));
  });

  it('answers 400 without a URL', async () => {
    as(ALICE);
    for (const body of [{}, { url: 42 }, { url: '' }, 'not json']) {
      const res = await release(body);
      expect(res.status).toBe(400);
    }
    expect(del).not.toHaveBeenCalled();
  });

  it("never frees someone else's upload, a snapshot, or anything outside the store", async () => {
    as(ALICE);
    for (const url of [
      blobOf(BOB),
      `${HOST}/snapshots/0f6d4c1e-1111-4222-8333-444455556666.jpg`,
      'https://images.example.com/photo.jpg',
      `https://otherstore.public.blob.vercel-storage.com/uploads/${ALICE}/image-abc.jpg`,
      // Out of the caller's folder by a path trick.
      `${HOST}/uploads/${ALICE}/../${BOB}/image-abc.jpg`,
      `${HOST}/uploads/${ALICE}/..%2F${BOB}%2Fimage-abc.jpg`,
      `${HOST}/uploads/${ALICE}/nested/image-abc.jpg`,
    ]) {
      await expectKept(await release({ url }));
    }
  });

  // regression: the reference check matched the URL as sent, while the store
  // finds a blob by its path, so a record's image with `?x` (or `#x`) appended
  // passed the check and freed the image the record still shows.
  it('regression: never frees an image a record shows, sent with a query or fragment', async () => {
    as(ALICE);
    await Item.collection.insertOne({ imageUrl: blobOf(ALICE) });
    for (const url of [`${blobOf(ALICE)}?x`, `${blobOf(ALICE)}?`, `${blobOf(ALICE)}#x`]) {
      await expectKept(await release({ url }));
    }
  });

  // Each record that can show an upload keeps it, the caller's own or anyone
  // else's: a co-owner keeping it on an item, an approved proposal, a
  // reservation whose snapshot copy failed and holds the item's blob.
  const holders: [string, (url: string) => Promise<unknown>][] = [
    ['an item', (url) => Item.collection.insertOne({ imageUrl: url })],
    ["a list's banner", (url) => Wishlist.collection.insertOne({ bannerUrl: url })],
    ['a profile photo', (url) => User.collection.insertOne({ image: url })],
    ['a reservation', (url) => Reservation.collection.insertOne({ itemImage: url })],
    ['a gift-history entry', (url) => GiftLog.collection.insertOne({ itemImage: url })],
  ];
  for (const [name, hold] of holders) {
    it(`keeps an upload ${name} shows, with the same answer as a freed one`, async () => {
      as(ALICE);
      await hold(blobOf(ALICE));
      await expectKept(await release({ url: blobOf(ALICE) }));
      // Another of the caller's uploads, which nothing shows, still goes.
      await release({ url: blobOf(ALICE, 'image-other.jpg') });
      expect(del).toHaveBeenCalledWith(blobOf(ALICE, 'image-other.jpg'));
    });
  }

  it('keeps an upload a record shows with a query or fragment after it', async () => {
    as(ALICE);
    await Wishlist.collection.insertOne({ bannerUrl: `${blobOf(ALICE)}?v=2` });
    await GiftLog.collection.insertOne({ itemImage: `${blobOf(ALICE, 'gift.jpg')}#top` });
    await expectKept(await release({ url: blobOf(ALICE) }));
    await expectKept(await release({ url: blobOf(ALICE, 'gift.jpg') }));
    // A longer name that only starts the same is another image.
    await Item.collection.insertOne({ imageUrl: blobOf(ALICE, 'solo.jpg.bak') });
    await release({ url: blobOf(ALICE, 'solo.jpg') });
    expect(del.mock.calls).toEqual([[blobOf(ALICE, 'solo.jpg')]]);
  });

  it('is rate-limited on its own budget, before touching anything', async () => {
    as(ALICE);
    const limit = vi.fn<RateLimiter['limit']>().mockResolvedValue({
      success: false,
      reset: Date.now() + 60_000,
      limit: 40,
      remaining: 0,
    });
    __setRateLimiters({ uploadRelease: { limit } });
    const res = await release({ url: blobOf(ALICE) });
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith(ALICE);
    expect(del).not.toHaveBeenCalled();
  });

  it('logs no URL or user id when it fails', async () => {
    as(ALICE);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exists = vi
      .spyOn(Item, 'exists')
      .mockRejectedValueOnce(new Error(`boom ${blobOf(ALICE)}`));
    const res = await release({ url: blobOf(ALICE) });
    expect(res.status).toBe(500);
    expect(del).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain(ALICE);
    exists.mockRestore();
    error.mockRestore();
  });
});

describe('releaseUnsavedUpload', () => {
  it('says whether it freed the upload', async () => {
    expect(await releaseUnsavedUpload(blobOf(ALICE), ALICE)).toBe(true);
    await Item.collection.insertOne({ imageUrl: blobOf(ALICE, 'kept.jpg') });
    expect(await releaseUnsavedUpload(blobOf(ALICE, 'kept.jpg'), ALICE)).toBe(false);
    expect(await releaseUnsavedUpload(blobOf(BOB), ALICE)).toBe(false);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('frees nothing without our own store configured', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(await releaseUnsavedUpload(blobOf(ALICE), ALICE)).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });
});
