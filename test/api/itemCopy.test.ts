import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// "Save to my list": POST /api/wishlists/[id]/items with a `sourceItemId` saves
// a copy of an item the caller can see into a list they own. These tests pin
// who may copy what, that the copy gets its own image blob (so deleting either
// item can't break the other), and that nothing about bookings comes across.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    rates: new Map([
      ['usd', 1],
      ['eur', 0.9],
    ]),
  }),
  convertToUsdCents: vi.fn(),
}));
// A store that records what it's asked to do instead of doing it.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
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
import { POST as CREATE_ITEM, GET as LIST_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { DELETE as DELETE_ITEM, PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { USER_UPLOAD_QUOTA_BYTES, FOREIGN_IMAGE_ERROR } from '@/lib/utils/blob';
import { COPY_IMAGE_FAILED_NOTICE, COPY_IMAGE_QUOTA_NOTICE } from '@/lib/utils/itemCopy';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';
import Follow from '@/models/Follow';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const EXTERNAL = 'https://images.example.com/photo.jpg';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let alice: string; // owns the list items are copied from
let bob: string; // the viewer saving copies into his own list
let carol: string; // a member of alice's list who proposes
let aliceList: string;
let bobList: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  copy.mockReset();
  del.mockClear();
  head.mockReset();
  list.mockReset();
  // A copy lands where it's asked to (the SDK would add a random suffix).
  copy.mockImplementation(async (_from: string, to: string) => ({
    url: `${HOST}/${to.replace(/(\.[a-z]+)$/, '-r4nd0m$1')}`,
  }));
  head.mockResolvedValue({ size: 1000 });
  list.mockResolvedValue({ blobs: [], cursor: undefined });

  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
  carol = (await User.create({ email: 'c@x.com', username: 'carol' }))._id.toString();
  aliceList = (
    await Wishlist.create({ name: 'Alice', owners: [alice], visibility: 'everyone' })
  )._id.toString();
  bobList = (
    await Wishlist.create({ name: 'Bob', owners: [bob], visibility: 'everyone' })
  )._id.toString();
  await WishlistMember.create({ wishlist: aliceList, user: carol });
});
afterEach(() => {
  vi.unstubAllEnvs();
  __setRateLimiters(null);
});

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function createIn(wishlistId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return CREATE_ITEM(req, params(wishlistId));
}

const deleteItem = (id: string) =>
  DELETE_ITEM(
    new NextRequest(`http://localhost/api/items/${id}`, { method: 'DELETE' }),
    params(id)
  );

const patchItem = (id: string, body: unknown) =>
  PATCH_ITEM(
    new NextRequest(`http://localhost/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(id)
  );

async function makeItem(fields: Record<string, unknown> = {}, wishlist = aliceList) {
  const item = await Item.create({
    wishlist,
    name: 'Blue Mug',
    imageUrl: blobOf(alice),
    price: { value: 2500, currency: 'EUR' },
    link: 'https://shop.example.com/mug',
    notes: 'Size M, the dark blue one',
    mostWanted: true,
    ...fields,
  });
  return item;
}

/** What the "Save to my list" modal sends for `source`, edited by `overrides`. */
function copyBody(
  source: { _id: unknown; name: string; imageUrl?: string | null },
  overrides = {}
) {
  return {
    name: source.name,
    imageUrl: source.imageUrl ?? undefined,
    price: { value: 2500, currency: 'EUR' },
    link: 'https://shop.example.com/mug',
    status: 'available',
    sourceItemId: String(source._id),
    ...overrides,
  };
}

describe('POST /api/wishlists/[id]/items with sourceItemId — saving a copy', () => {
  it('saves a copy of a visible item into the caller’s list, with no notification', async () => {
    const source = await makeItem();
    as(bob);

    const res = await createIn(bobList, copyBody(source));

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBeUndefined();
    expect(data).toMatchObject({
      wishlist: bobList,
      name: 'Blue Mug',
      price: { value: 2500, currency: 'EUR' },
      link: 'https://shop.example.com/mug',
      status: 'available',
      mostWanted: false,
    });
    // Nothing the modal didn't send: not the source owner's notes.
    expect(data.notes).toBeUndefined();
    expect(await Item.countDocuments({ wishlist: bobList })).toBe(1);
    // The source is untouched, and nobody is told.
    const after = await Item.findById(source._id).lean();
    expect(after).toMatchObject({ name: 'Blue Mug', imageUrl: blobOf(alice), mostWanted: true });
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('gives the copy a new blob in the caller’s own uploads folder', async () => {
    const source = await makeItem();
    as(bob);

    const { data } = await (await createIn(bobList, copyBody(source))).json();

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(
      blobOf(alice),
      `uploads/${bob}/image.jpg`,
      expect.objectContaining({ access: 'public', addRandomSuffix: true })
    );
    expect(data.imageUrl).toBe(`${HOST}/uploads/${bob}/image-r4nd0m.jpg`);
    expect(data.imageUrl).not.toBe(source.imageUrl);
    expect((await Item.findById(data._id))?.imageUrl).toBe(data.imageUrl);
  });

  it("deleting the source doesn't touch the copy's image, nor deleting the copy the source's", async () => {
    const source = await makeItem();
    as(bob);
    const { data: copied } = await (await createIn(bobList, copyBody(source))).json();

    as(alice);
    expect((await deleteItem(source._id.toString())).status).toBe(200);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(blobOf(alice));
    expect((await Item.findById(copied._id))?.imageUrl).toBe(copied.imageUrl);

    // And the other way round, on a fresh pair.
    del.mockClear();
    const second = await makeItem({ imageUrl: blobOf(alice, 'image-two.jpg') });
    as(bob);
    const { data: copy2 } = await (await createIn(bobList, copyBody(second))).json();
    expect((await deleteItem(copy2._id)).status).toBe(200);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(copy2.imageUrl);
    expect((await Item.findById(second._id))?.imageUrl).toBe(blobOf(alice, 'image-two.jpg'));
  });

  it('copies the blob between your own lists too, so the two items never share one', async () => {
    const otherAliceList = (
      await Wishlist.create({ name: 'Alice 2', owners: [alice], visibility: 'private' })
    )._id.toString();
    const source = await makeItem();
    as(alice);

    const { data } = await (await createIn(otherAliceList, copyBody(source))).json();

    expect(copy).toHaveBeenCalledTimes(1);
    expect(data.imageUrl).toBe(`${HOST}/uploads/${alice}/image-r4nd0m.jpg`);
    expect(data.imageUrl).not.toBe(source.imageUrl);
  });

  it('reuses an external image URL as it is', async () => {
    const source = await makeItem({ imageUrl: EXTERNAL });
    as(bob);

    const { data } = await (await createIn(bobList, copyBody(source))).json();

    expect(copy).not.toHaveBeenCalled();
    expect(data.imageUrl).toBe(EXTERNAL);
  });

  it('keeps an image the caller swapped in for their own upload, or took out', async () => {
    const source = await makeItem();
    as(bob);

    const own = blobOf(bob, 'image-mine.jpg');
    const res = await createIn(bobList, copyBody(source, { imageUrl: own }));
    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(data.imageUrl).toBe(own);
    expect(notice).toBeUndefined();

    const none = await createIn(bobList, copyBody(source, { imageUrl: undefined }));
    expect((await none.json()).data.imageUrl).toBeUndefined();
    expect(copy).not.toHaveBeenCalled();
  });

  it("never attaches someone else's blob that isn't the source's image: saves without it", async () => {
    // As when the source's image was replaced after the form was filled in.
    const source = await makeItem();
    const stale = blobOf(alice, 'image-before.jpg');
    as(bob);

    const res = await createIn(bobList, copyBody(source, { imageUrl: stale }));

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(data.imageUrl).toBeUndefined();
    expect(notice).toBe(COPY_IMAGE_FAILED_NOTICE);
    expect(copy).not.toHaveBeenCalled();
    expect((await Item.findById(data._id))?.imageUrl).toBeUndefined();
  });

  it("still refuses someone else's blob on a create that isn't a copy", async () => {
    as(bob);

    const res = await createIn(bobList, {
      name: 'Mug',
      imageUrl: blobOf(alice, 'image-other.jpg'),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(FOREIGN_IMAGE_ERROR);
  });

  it('saves without the image, and says so, when the copy would go over the quota', async () => {
    const source = await makeItem();
    list.mockResolvedValue({
      blobs: [{ size: USER_UPLOAD_QUOTA_BYTES - 500 }],
      cursor: undefined,
    });
    as(bob);

    const res = await createIn(bobList, copyBody(source));

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBe(COPY_IMAGE_QUOTA_NOTICE);
    expect(data.imageUrl).toBeUndefined();
    expect(data.name).toBe('Blue Mug');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: `uploads/${bob}/` }));
    expect(copy).not.toHaveBeenCalled();
  });

  it('saves without the image, and says so, when the copy fails', async () => {
    const source = await makeItem();
    copy.mockRejectedValue(new Error('store unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    as(bob);

    const res = await createIn(bobList, copyBody(source));

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBe(COPY_IMAGE_FAILED_NOTICE);
    expect(data.imageUrl).toBeUndefined();
    vi.mocked(console.error).mockRestore();
  });

  it('frees the copied blob when the item then fails to save', async () => {
    const source = await makeItem();
    const create = vi.spyOn(Item, 'create').mockRejectedValueOnce(new Error('write failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    as(bob);

    const res = await createIn(bobList, copyBody(source));

    expect(res.status).toBe(500);
    expect(del).toHaveBeenCalledWith(`${HOST}/uploads/${bob}/image-r4nd0m.jpg`);
    create.mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it('makes no copy for a request refused on its other fields', async () => {
    const source = await makeItem();
    as(bob);

    const res = await createIn(
      bobList,
      copyBody(source, { price: { value: 100, currency: 'XYZ' } })
    );

    expect(res.status).toBe(400);
    expect(copy).not.toHaveBeenCalled();
    expect(await Item.countDocuments({ wishlist: bobList })).toBe(0);
  });
});

describe('POST /api/wishlists/[id]/items with sourceItemId — nothing about bookings comes across', () => {
  it('a booked source gives the same copy as an available one: fresh, unbooked, unproposed', async () => {
    const booked = await makeItem({ name: 'Mug', status: 'booked', bookedBy: carol });
    await Reservation.create({
      gifter: carol,
      item: booked._id,
      wishlist: aliceList,
      owner: alice,
      itemName: 'Mug',
      wishlistName: 'Alice',
    });
    const available = await makeItem({ name: 'Mug', imageUrl: blobOf(alice, 'image-2.jpg') });
    as(bob);

    const fromBooked = await (await createIn(bobList, copyBody(booked))).json();
    const fromAvailable = await (await createIn(bobList, copyBody(available))).json();

    const comparable = (body: { data: Record<string, unknown> }) => {
      const { _id, createdAt, updatedAt, ...rest } = body.data;
      void _id;
      void createdAt;
      void updatedAt;
      return rest;
    };
    expect(comparable(fromBooked)).toEqual(comparable(fromAvailable));
    expect(fromBooked.data.status).toBe('available');
    expect(fromBooked.data.bookedBy ?? null).toBeNull();
    expect(fromBooked.data.proposedBy).toBeUndefined();

    const stored = await Item.findById(fromBooked.data._id).lean();
    expect(stored?.bookedBy ?? null).toBeNull();
    expect(stored?.proposedBy).toBeUndefined();
    // The source keeps its booking; the copy has no reservation of its own.
    expect((await Item.findById(booked._id))?.status).toBe('booked');
    expect(await Reservation.countDocuments({ item: fromBooked.data._id })).toBe(0);
    expect(await Reservation.countDocuments({ item: booked._id })).toBe(1);
  });

  it('an owner copying their own booked item learns nothing of the booking', async () => {
    const otherAliceList = (
      await Wishlist.create({ name: 'Alice 2', owners: [alice], visibility: 'everyone' })
    )._id.toString();
    const booked = await makeItem({ status: 'booked', bookedBy: carol });
    as(alice);

    const res = await createIn(otherAliceList, copyBody(booked));

    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(carol);
    const { data } = JSON.parse(text);
    expect(data.status).toBe('available');
    expect(data.bookedBy ?? null).toBeNull();
  });

  it('ignores a bookedBy, proposedBy or booked status sent with a copy', async () => {
    const source = await makeItem();
    as(bob);

    const booked = await createIn(bobList, copyBody(source, { status: 'booked' }));
    expect(booked.status).toBe(400);

    const res = await createIn(
      bobList,
      copyBody(source, { bookedBy: carol, proposedBy: carol, status: 'draft' })
    );
    expect(res.status).toBe(201);
    const stored = await Item.findById((await res.json()).data._id).lean();
    expect(stored?.status).toBe('draft');
    expect(stored?.bookedBy ?? null).toBeNull();
    expect(stored?.proposedBy).toBeUndefined();
  });
});

describe('POST /api/wishlists/[id]/items with sourceItemId — what can be copied', () => {
  /** Expect a 404 that copies nothing and creates nothing. */
  async function expectNotFound(res: Response) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Item not found' });
    expect(copy).not.toHaveBeenCalled();
    expect(await Item.countDocuments({ wishlist: bobList })).toBe(0);
  }

  it('404s for an item on a list the caller can’t see', async () => {
    as(bob);
    for (const visibility of ['private', 'friends'] as const) {
      await Wishlist.updateOne({ _id: aliceList }, { visibility });
      const source = await makeItem();
      await expectNotFound(await createIn(bobList, copyBody(source)));
    }
  });

  it('404s for an item on an archived list, even to one of its members', async () => {
    await Wishlist.updateOne({ _id: aliceList }, { archived: true });
    await WishlistMember.create({ wishlist: aliceList, user: bob });
    const source = await makeItem();
    as(bob);

    await expectNotFound(await createIn(bobList, copyBody(source)));
  });

  it('404s for a draft, even to its own owner', async () => {
    const otherAliceList = (
      await Wishlist.create({ name: 'Alice 2', owners: [alice], visibility: 'everyone' })
    )._id.toString();
    const draft = await makeItem({ status: 'draft' });

    as(bob);
    await expectNotFound(await createIn(bobList, copyBody(draft)));
    as(alice);
    const res = await createIn(otherAliceList, copyBody(draft));
    expect(res.status).toBe(404);
    expect(await Item.countDocuments({ wishlist: otherAliceList })).toBe(0);
  });

  it("404s for someone else's proposal, to a member and to the list's owner alike", async () => {
    const proposal = await makeItem({ status: 'proposed', proposedBy: carol });
    await WishlistMember.create({ wishlist: aliceList, user: bob });

    as(bob);
    await expectNotFound(await createIn(bobList, copyBody(proposal)));

    const otherAliceList = (
      await Wishlist.create({ name: 'Alice 2', owners: [alice], visibility: 'everyone' })
    )._id.toString();
    as(alice);
    expect((await createIn(otherAliceList, copyBody(proposal))).status).toBe(404);
    expect(await Item.countDocuments({ wishlist: otherAliceList })).toBe(0);
  });

  it('404s for a missing or malformed sourceItemId', async () => {
    as(bob);
    const missing = { _id: new mongoose.Types.ObjectId(), name: 'Gone', imageUrl: EXTERNAL };
    await expectNotFound(await createIn(bobList, copyBody(missing)));
    for (const bad of ['not-an-id', '12345', 'z'.repeat(24), '']) {
      await expectNotFound(await createIn(bobList, copyBody(missing, { sourceItemId: bad })));
    }
  });

  it('answers a hidden item exactly as a missing one', async () => {
    await Wishlist.updateOne({ _id: aliceList }, { visibility: 'private' });
    const hidden = await makeItem();
    as(bob);

    const hiddenRes = await createIn(bobList, copyBody(hidden));
    const missingRes = await createIn(
      bobList,
      copyBody({ _id: new mongoose.Types.ObjectId(), name: 'Blue Mug', imageUrl: blobOf(alice) })
    );

    expect(hiddenRes.status).toBe(missingRes.status);
    expect(await hiddenRes.json()).toEqual(await missingRes.json());
  });

  it('copies from a private list the caller is a member of, and from a friend’s friends-only list', async () => {
    await Wishlist.updateOne({ _id: aliceList }, { visibility: 'private' });
    await WishlistMember.create({ wishlist: aliceList, user: bob });
    as(bob);
    expect((await createIn(bobList, copyBody(await makeItem()))).status).toBe(201);

    await WishlistMember.deleteMany({ wishlist: aliceList, user: bob });
    await Wishlist.updateOne({ _id: aliceList }, { visibility: 'friends' });
    await Follow.create({ follower: bob, following: alice });
    await Follow.create({ follower: alice, following: bob });
    expect((await createIn(bobList, copyBody(await makeItem()))).status).toBe(201);
  });

  it('copies a completed item, and a proposal by the one who proposed it', async () => {
    const completed = await makeItem({ status: 'completed' });
    const ownProposal = await makeItem({ status: 'proposed', proposedBy: bob });
    await WishlistMember.create({ wishlist: aliceList, user: bob });
    as(bob);

    expect((await createIn(bobList, copyBody(completed))).status).toBe(201);
    expect((await createIn(bobList, copyBody(ownProposal))).status).toBe(201);
  });

  it('lets an owner copy out of their own archived list', async () => {
    const otherAliceList = (
      await Wishlist.create({ name: 'Alice 2', owners: [alice], visibility: 'everyone' })
    )._id.toString();
    await Wishlist.updateOne({ _id: aliceList }, { archived: true });
    const source = await makeItem();
    as(alice);

    expect((await createIn(otherAliceList, copyBody(source))).status).toBe(201);
  });
});

describe('POST /api/wishlists/[id]/items with sourceItemId — where a copy can go', () => {
  it('refuses a copy into a list the caller is only a member of, and saves nothing', async () => {
    const source = await makeItem({ imageUrl: EXTERNAL });
    as(carol);

    const res = await createIn(aliceList, copyBody(source, { status: 'proposed' }));

    expect(res.status).toBe(403);
    expect(await Item.countDocuments()).toBe(1);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it("refuses a copy into someone else's list, as any create there is", async () => {
    const source = await makeItem();
    as(bob);

    expect((await createIn(aliceList, copyBody(source))).status).toBe(403);
    expect(copy).not.toHaveBeenCalled();
  });

  it('is limited by the content rate limit', async () => {
    const denyAll: RateLimiter = {
      async limit() {
        return { success: false, reset: Date.now() + 60_000, limit: 60, remaining: 0 };
      },
    };
    __setRateLimiters({ content: denyAll });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = await makeItem();
    as(bob);

    expect((await createIn(bobList, copyBody(source))).status).toBe(429);
    expect(copy).not.toHaveBeenCalled();
    expect(await Item.countDocuments({ wishlist: bobList })).toBe(0);
    vi.mocked(console.warn).mockRestore();
  });

  it('shows the copy in the target list like any new item', async () => {
    const source = await makeItem();
    as(bob);
    await createIn(bobList, copyBody(source));

    const res = await LIST_ITEMS(
      new NextRequest(`http://localhost/api/wishlists/${bobList}/items`),
      params(bobList)
    );
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ name: 'Blue Mug', status: 'available' });

    // And it's an ordinary item of bob's: he can edit it, keeping the copied image.
    const edit = await patchItem(data[0]._id, { name: 'Blue Mug (L)', imageUrl: data[0].imageUrl });
    expect(edit.status).toBe(200);
  });
});
