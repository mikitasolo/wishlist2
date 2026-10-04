import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// regression (WIS-182): POST /api/wishlists/[id]/items read the list, then
// wrote the item. A list delete landing between the two (the list goes first,
// then its items and their images) left the new item behind with nothing to
// reach or free it, and on a "Save to my list" copy, a copied blob counting
// against the caller's quota. The route now re-reads the list once the item is
// written and, if it's gone, takes the item back, frees its image, and answers
// 404.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records what it's asked to do instead of doing it.
const copy = vi.fn();
const del = vi.fn();
const head = vi.fn();
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  head: (...a: unknown[]) => head(...a),
  list: (...a: unknown[]) => list(...a),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { deleteOwnedWishlist } from '@/lib/utils/wishlistDeletion';
import { IDEMPOTENCY_HEADER, scopedIdempotencyKey } from '@/lib/utils/itemIdempotency';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let owner: string;
let member: string;
let other: string; // owns the list a copy is made from
let listId: string;
let otherList: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  copy.mockReset();
  del.mockReset();
  head.mockReset();
  list.mockReset();
  del.mockResolvedValue(undefined);
  copy.mockImplementation(async (_from: string, to: string) => ({ url: `${HOST}/${to}` }));
  head.mockResolvedValue({ size: 1000 });
  list.mockResolvedValue({ blobs: [], cursor: undefined });

  owner = (await User.create({ email: 'o@x.com', username: 'owner' }))._id.toString();
  member = (await User.create({ email: 'm@x.com', username: 'member' }))._id.toString();
  other = (await User.create({ email: 'x@x.com', username: 'other' }))._id.toString();
  listId = (
    await Wishlist.create({ name: 'Birthday', owners: [owner], visibility: 'everyone' })
  )._id.toString();
  otherList = (
    await Wishlist.create({ name: 'Other', owners: [other], visibility: 'everyone' })
  )._id.toString();
  await WishlistMember.create({ wishlist: listId, user: member });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

function create(body: unknown, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost/api/wishlists/${listId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return CREATE_ITEM(req, { params: Promise.resolve({ id: listId }) });
}

/** The owner deletes the list, through the path the list's own DELETE takes. */
const deleteList = () => deleteOwnedWishlist(listId, owner);

/** The blob URLs the store was asked to delete. */
const deletedBlobs = () => del.mock.calls.map(([url]) => url);

async function expectGone(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ success: false, error: 'This wishlist no longer exists' });
  expect(await Wishlist.exists({ _id: listId })).toBeNull();
  expect(await Item.countDocuments({ wishlist: listId })).toBe(0);
}

describe('POST /api/wishlists/[id]/items while the list is deleted', () => {
  it("takes back an owner's item written after the delete's cleanup, and frees its upload", async () => {
    as(owner);
    const image = blobOf(owner);
    const race = holdFirstCall(Item, 'create', deleteList);

    const res = await create({ name: 'Mug', status: 'available', imageUrl: image });

    expect(race.held()).toBe(true);
    await expectGone(res);
    expect(deletedBlobs()).toContain(image);
  });

  it("frees an owner's upload when the delete's cleanup removed the item without reading it", async () => {
    as(owner);
    const image = blobOf(owner);
    // The cleanup read the list's images before this item was written, then
    // deleted the items, this one included, so it frees nothing of it.
    const race = holdFirstCall(
      Item,
      'create',
      async () => {
        await Wishlist.deleteOne({ _id: listId });
        await Item.deleteMany({ wishlist: listId });
      },
      { after: true }
    );

    const res = await create({ name: 'Mug', status: 'available', imageUrl: image });

    expect(race.held()).toBe(true);
    await expectGone(res);
    expect(deletedBlobs()).toEqual([image]);
  });

  it("takes back a member's proposal and notifies nobody", async () => {
    as(member);
    const race = holdFirstCall(Item, 'create', deleteList);

    const res = await create({ name: 'Scarf', status: 'proposed' });

    expect(race.held()).toBe(true);
    await expectGone(res);
    expect(await Notification.countDocuments({ wishlist: listId })).toBe(0);
  });

  it("takes back a copy and frees the blob copied for it, leaving the source's", async () => {
    const sourceImage = blobOf(other, 'source.jpg');
    const source = await Item.create({
      wishlist: otherList,
      name: 'Lamp',
      imageUrl: sourceImage,
      status: 'available',
    });
    as(owner);
    const race = holdFirstCall(Item, 'create', deleteList);

    const res = await create({
      name: 'Lamp',
      status: 'available',
      imageUrl: sourceImage,
      sourceItemId: source._id.toString(),
    });

    expect(race.held()).toBe(true);
    await expectGone(res);
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = deletedBlobs().find((url) => url.includes(`/uploads/${owner}/`));
    expect(copied).toBeDefined();
    expect(deletedBlobs()).not.toContain(sourceImage);
    expect(await Item.exists({ _id: source._id })).not.toBeNull();
  });

  it("frees a copy's blob when the delete lands just after the write and its cleanup takes the item", async () => {
    const sourceImage = blobOf(other, 'source.jpg');
    const source = await Item.create({
      wishlist: otherList,
      name: 'Lamp',
      imageUrl: sourceImage,
      status: 'available',
    });
    as(owner);
    const race = holdFirstCall(Item, 'create', deleteList, { after: true });

    const res = await create({
      name: 'Lamp',
      status: 'available',
      imageUrl: sourceImage,
      sourceItemId: source._id.toString(),
    });

    expect(race.held()).toBe(true);
    await expectGone(res);
    expect(deletedBlobs().some((url) => url.includes(`/uploads/${owner}/`))).toBe(true);
    expect(deletedBlobs()).not.toContain(sourceImage);
  });

  it("doesn't replay an item whose list was deleted after the retry read it", async () => {
    as(owner);
    const key = 'retry-key-0000000001';
    await Item.create({
      wishlist: listId,
      name: 'Mug',
      status: 'available',
      idempotencyKey: scopedIdempotencyKey(owner, key),
    });
    // The delete has removed the list but not yet its items.
    const race = holdFirstCall(Item, 'findOne', () => Wishlist.deleteOne({ _id: listId }));

    const res = await create({ name: 'Mug', status: 'available' }, { [IDEMPOTENCY_HEADER]: key });

    expect(race.held()).toBe(true);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'This wishlist no longer exists' });
  });

  it('keeps the item when the list is still there', async () => {
    as(owner);
    const res = await create({ name: 'Mug', status: 'available', imageUrl: blobOf(owner) });

    expect(res.status).toBe(201);
    expect(await Item.countDocuments({ wishlist: listId })).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps the item, and answers 201, when the re-check itself fails', async () => {
    as(owner);
    vi.spyOn(Wishlist, 'exists').mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await create({ name: 'Mug', status: 'available' });

    expect(res.status).toBe(201);
    expect(await Item.countDocuments({ wishlist: listId })).toBe(1);
  });
});
