import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Every image field (User.image, Wishlist.bannerUrl, Item.imageUrl) is freed with
// deleteOwnBlob once it's replaced or its record is deleted. These tests pin the
// write-side guard: you may only attach blobs from your own uploads/<id>/ folder
// (or keep the value already on the record), so nobody can get someone else's
// image deleted.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// Record what would be deleted instead of talking to a store.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as PATCH_ME } from '@/app/api/users/me/route';
import { POST as CREATE_WISHLIST } from '@/app/api/wishlists/route';
import { PATCH as PATCH_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { FOREIGN_IMAGE_ERROR } from '@/lib/utils/blob';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const EXTERNAL = 'https://images.example.com/photo.jpg';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let alice: string; // attacker / actor
let victim: string; // someone whose uploads alice can see on a public page
let bob: string; // alice's co-owner

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  victim = (await User.create({ email: 'v@x.com', username: 'victim' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

function json(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const patchMe = (body: unknown) => PATCH_ME(json('http://localhost/api/users/me', 'PATCH', body));
const createWishlist = (body: unknown) =>
  CREATE_WISHLIST(json('http://localhost/api/wishlists', 'POST', body));
const patchWishlist = (id: string, body: unknown) =>
  PATCH_WISHLIST(json(`http://localhost/api/wishlists/${id}`, 'PATCH', body), {
    params: Promise.resolve({ id }),
  });
const createItem = (wishlistId: string, body: unknown) =>
  CREATE_ITEM(json(`http://localhost/api/wishlists/${wishlistId}/items`, 'POST', body), {
    params: Promise.resolve({ id: wishlistId }),
  });
const patchItem = (id: string, body: unknown) =>
  PATCH_ITEM(json(`http://localhost/api/items/${id}`, 'PATCH', body), {
    params: Promise.resolve({ id }),
  });

async function expectForeignImageRejected(res: Response) {
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe(FOREIGN_IMAGE_ERROR);
}

describe('User.image — PATCH /api/users/me', () => {
  // regression: isOwnBlob matched any *.blob.vercel-storage.com URL (every
  // user's folder) and `image` accepted any URL, so setting someone else's
  // avatar URL and then clearing it deleted their blob.
  it('regression: rejects another user’s blob and never deletes it', async () => {
    as(alice);
    const theirs = blobOf(victim);

    await expectForeignImageRejected(await patchMe({ image: theirs, bio: 'hi' }));
    expect((await User.findById(alice))?.image ?? null).toBeNull();
    expect((await User.findById(alice))?.bio ?? null).toBeNull(); // nothing else saved

    // The second half of the attack now has nothing to clear.
    expect((await patchMe({ image: '' })).status).toBe(200);
    expect(del).not.toHaveBeenCalled();
  });

  // regression: an avatar saved before the write check could still hold a
  // foreign blob; clearing it must not delete the other user's image.
  it('regression: never frees a foreign avatar that was stored before the guard', async () => {
    const theirs = blobOf(victim);
    await User.updateOne({ _id: alice }, { image: theirs });
    as(alice);

    expect((await patchMe({ image: '' })).status).toBe(200);
    expect((await User.findById(alice))?.image).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it('accepts your own upload and an external URL', async () => {
    as(alice);
    expect((await patchMe({ image: blobOf(alice) })).status).toBe(200);
    expect((await User.findById(alice))?.image).toBe(blobOf(alice));

    expect((await patchMe({ image: EXTERNAL })).status).toBe(200);
    expect((await User.findById(alice))?.image).toBe(EXTERNAL);
  });

  it('frees your own previous upload when you replace it, but never an external URL', async () => {
    as(alice);
    const first = blobOf(alice, 'image-1.jpg');
    await patchMe({ image: first });

    await patchMe({ image: blobOf(alice, 'image-2.jpg') });
    expect(del).toHaveBeenCalledWith(first);

    del.mockClear();
    await patchMe({ image: EXTERNAL });
    await patchMe({ image: '' });
    expect(del).toHaveBeenCalledTimes(1); // only image-2, never the external URL
    expect(del).toHaveBeenCalledWith(blobOf(alice, 'image-2.jpg'));
  });
});

describe('Wishlist.bannerUrl — POST /api/wishlists and PATCH /api/wishlists/[id]', () => {
  // regression: bannerUrl accepted any URL and isOwnBlob matched every user's
  // folder, so a banner could point at someone else's blob and free it.
  it('regression: rejects another user’s blob as the banner of a new list', async () => {
    as(alice);
    await expectForeignImageRejected(
      await createWishlist({ name: 'Mine', bannerUrl: blobOf(victim) })
    );
    expect(await Wishlist.countDocuments()).toBe(0);
  });

  it('creates a list with your own upload or an external banner', async () => {
    as(alice);
    expect((await createWishlist({ name: 'A', bannerUrl: blobOf(alice) })).status).toBe(201);
    expect((await createWishlist({ name: 'B', bannerUrl: EXTERNAL })).status).toBe(201);
  });

  // regression: see above — the update path had the same hole.
  it('regression: rejects another user’s blob on update and changes nothing', async () => {
    const wl = await Wishlist.create({ name: 'Mine', owners: [alice], visibility: 'everyone' });
    const id = wl._id.toString();
    as(alice);

    await expectForeignImageRejected(
      await patchWishlist(id, { name: 'Renamed', featured: true, bannerUrl: blobOf(victim) })
    );
    const after = await Wishlist.findById(id);
    expect(after?.name).toBe('Mine');
    expect(after?.bannerUrl ?? null).toBeNull();
    expect(after?.featuredBy ?? []).toHaveLength(0);

    await patchWishlist(id, { bannerUrl: '' });
    expect(del).not.toHaveBeenCalled();
  });

  it('lets a co-owner edit a list whose banner the other co-owner uploaded', async () => {
    const banner = blobOf(bob);
    const wl = await Wishlist.create({
      name: 'Ours',
      owners: [bob, alice],
      visibility: 'everyone',
      bannerUrl: banner,
    });
    const id = wl._id.toString();
    as(alice);

    // The settings form sends the whole form back, banner included.
    const res = await patchWishlist(id, { name: 'Renamed', bannerUrl: banner });
    expect(res.status).toBe(200);
    expect((await Wishlist.findById(id))?.bannerUrl).toBe(banner);
    expect(del).not.toHaveBeenCalled();
  });

  it('frees your own previous banner when you replace it', async () => {
    const first = blobOf(alice, 'banner-1.jpg');
    const wl = await Wishlist.create({
      name: 'Mine',
      owners: [alice],
      visibility: 'everyone',
      bannerUrl: first,
    });
    as(alice);

    const res = await patchWishlist(wl._id.toString(), {
      bannerUrl: blobOf(alice, 'banner-2.jpg'),
    });
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(first);
  });
});

describe('Item.imageUrl — POST /api/wishlists/[id]/items and PATCH /api/items/[id]', () => {
  let wishlistId: string;
  let member: string;

  beforeEach(async () => {
    member = (await User.create({ email: 'm@x.com', username: 'member' }))._id.toString();
    const wl = await Wishlist.create({
      name: 'Ours',
      owners: [alice, bob],
      visibility: 'everyone',
    });
    wishlistId = wl._id.toString();
    await WishlistMember.create({ wishlist: wl._id, user: member });
  });

  // regression: imageUrl accepted any URL and isOwnBlob matched every user's
  // folder, so an item could point at someone else's blob, and deleting the
  // item (or replacing its image) freed it.
  it('regression: an owner cannot create an item with another user’s blob', async () => {
    as(alice);
    await expectForeignImageRejected(
      await createItem(wishlistId, { name: 'Gift', imageUrl: blobOf(victim) })
    );
    expect(await Item.countDocuments()).toBe(0);
  });

  // regression: same hole, via a member's proposal.
  it('regression: a member cannot propose an item with another user’s blob', async () => {
    as(member);
    await expectForeignImageRejected(
      await createItem(wishlistId, {
        name: 'Idea',
        status: 'proposed',
        imageUrl: blobOf(victim),
      })
    );
    expect(await Item.countDocuments()).toBe(0);
  });

  it('creates and proposes items with your own upload or an external URL', async () => {
    as(alice);
    expect((await createItem(wishlistId, { name: 'A', imageUrl: blobOf(alice) })).status).toBe(201);
    expect((await createItem(wishlistId, { name: 'B', imageUrl: EXTERNAL })).status).toBe(201);

    as(member);
    const res = await createItem(wishlistId, {
      name: 'C',
      status: 'proposed',
      imageUrl: blobOf(member),
    });
    expect(res.status).toBe(201);
  });

  // regression: see above — the update path had the same hole.
  it('regression: an owner cannot switch an item to another user’s blob', async () => {
    const item = await Item.create({ wishlist: wishlistId, name: 'Gift', imageUrl: EXTERNAL });
    const id = item._id.toString();
    as(alice);

    await expectForeignImageRejected(
      await patchItem(id, { name: 'Renamed', imageUrl: blobOf(victim) })
    );
    const after = await Item.findById(id);
    expect(after?.name).toBe('Gift');
    expect(after?.imageUrl).toBe(EXTERNAL);

    await patchItem(id, { imageUrl: null });
    expect(del).not.toHaveBeenCalled();
  });

  it('regression: a proposer cannot switch their proposal to another user’s blob', async () => {
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: member,
    });
    as(member);

    await expectForeignImageRejected(
      await patchItem(item._id.toString(), { imageUrl: blobOf(victim) })
    );
    expect((await Item.findById(item._id))?.imageUrl ?? null).toBeNull();
  });

  it('lets a co-owner edit an item whose image the other co-owner uploaded', async () => {
    const image = blobOf(bob);
    const item = await Item.create({ wishlist: wishlistId, name: 'Gift', imageUrl: image });
    as(alice);

    // The edit form sends the unchanged image URL back with the other fields.
    const res = await patchItem(item._id.toString(), { name: 'Renamed', imageUrl: image });
    expect(res.status).toBe(200);
    const after = await Item.findById(item._id);
    expect(after?.name).toBe('Renamed');
    expect(after?.imageUrl).toBe(image);
    expect(del).not.toHaveBeenCalled();
  });

  it('lets an owner approve a proposal and keep the proposer’s image', async () => {
    const image = blobOf(member);
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: member,
      imageUrl: image,
    });
    as(alice);

    const res = await patchItem(item._id.toString(), {
      name: 'Idea',
      imageUrl: image,
      status: 'available',
    });
    expect(res.status).toBe(200);
    const after = await Item.findById(item._id);
    expect(after?.status).toBe('available');
    expect(after?.imageUrl).toBe(image);
    expect(del).not.toHaveBeenCalled();
  });

  it('frees your own previous upload when you replace an item image', async () => {
    const first = blobOf(alice, 'item-1.jpg');
    const item = await Item.create({ wishlist: wishlistId, name: 'Gift', imageUrl: first });
    as(alice);

    const res = await patchItem(item._id.toString(), { imageUrl: blobOf(alice, 'item-2.jpg') });
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(first);
  });
});
