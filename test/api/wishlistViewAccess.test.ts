import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// The real slug generator, wrapped so a test can run something in between the
// backfill's read and its write.
vi.mock('@/lib/utils/wishlistSlug', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/wishlistSlug')>();
  return { ...actual, generateUniqueWishlistSlug: vi.fn(actual.generateUniqueWishlistSlug) };
});

import { auth } from '@/lib/auth';
import { generateUniqueWishlistSlug } from '@/lib/utils/wishlistSlug';
import { GET as GET_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { GET as LIST_ITEMS, POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { PATCH as PATCH_ITEM, DELETE as DELETE_ITEM } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

type Visibility = 'everyone' | 'friends' | 'private';

// The cast of viewers. Two co-owners, so the friends tier is checked against
// *any* owner rather than just the first.
let owner: string;
let coOwner: string;
let member: string;
let friendOfOwner: string;
let friendOfCoOwner: string;
let follower: string; // follows the owner, who doesn't follow back: not a friend
let stranger: string;

let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

async function user(username: string) {
  const u = await User.create({ email: `${username}@x.com`, username });
  return u._id.toString();
}

async function befriend(a: string, b: string) {
  await Follow.create([
    { follower: a, following: b },
    { follower: b, following: a },
  ]);
}

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  owner = await user('owner');
  coOwner = await user('coowner');
  member = await user('member');
  friendOfOwner = await user('friendofowner');
  friendOfCoOwner = await user('friendofcoowner');
  follower = await user('follower');
  stranger = await user('stranger');
  await befriend(owner, friendOfOwner);
  await befriend(coOwner, friendOfCoOwner);
  await Follow.create({ follower, following: owner });
});

async function makeList(visibility: Visibility, archived = false) {
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [owner, coOwner],
    visibility,
    isPublic: visibility === 'everyone',
    archived,
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: member });
  return wishlistId;
}

async function makeItem(status = 'available', extra: Record<string, unknown> = {}) {
  const item = await Item.create({
    wishlist: wishlistId,
    name: `${status} gift`,
    status,
    ...extra,
  });
  return item._id.toString();
}

function as(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

function getWishlist(id: string, userId: string | null) {
  as(userId);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}`);
  return GET_WISHLIST(req, { params: Promise.resolve({ id }) });
}

function listItems(id: string, userId: string | null) {
  as(userId);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/items`);
  return LIST_ITEMS(req, { params: Promise.resolve({ id }) });
}

function propose(id: string, userId: string) {
  as(userId);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Idea', status: 'proposed' }),
  });
  return CREATE_ITEM(req, { params: Promise.resolve({ id }) });
}

function createAsOwner(id: string) {
  as(owner);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'New', status: 'available' }),
  });
  return CREATE_ITEM(req, { params: Promise.resolve({ id }) });
}

function patchItem(id: string, userId: string, body: unknown) {
  as(userId);
  const req = new NextRequest(`http://localhost/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH_ITEM(req, { params: Promise.resolve({ id }) });
}

function deleteItem(id: string, userId: string) {
  as(userId);
  const req = new NextRequest(`http://localhost/api/items/${id}`, { method: 'DELETE' });
  return DELETE_ITEM(req, { params: Promise.resolve({ id }) });
}

const NOT_FOUND = { success: false, error: 'Wishlist not found' };
const ITEM_NOT_FOUND = { success: false, error: 'Item not found' };
const missingId = () => new mongoose.Types.ObjectId().toString();

describe('the wishlist and its items share one set of access rules', () => {
  const viewers = () =>
    ({
      anonymous: null,
      stranger,
      follower,
      member,
      friendOfOwner,
      friendOfCoOwner,
      owner,
      coOwner,
    }) as Record<string, string | null>;

  const expected: Record<Visibility, Record<string, number>> = {
    everyone: {
      anonymous: 200,
      stranger: 200,
      follower: 200,
      member: 200,
      friendOfOwner: 200,
      friendOfCoOwner: 200,
      owner: 200,
      coOwner: 200,
    },
    friends: {
      anonymous: 401,
      stranger: 403,
      follower: 403,
      member: 200,
      friendOfOwner: 200,
      friendOfCoOwner: 200,
      owner: 200,
      coOwner: 200,
    },
    private: {
      anonymous: 401,
      stranger: 403,
      follower: 403,
      member: 200,
      friendOfOwner: 403,
      friendOfCoOwner: 403,
      owner: 200,
      coOwner: 200,
    },
  };

  // Archived is owner-only whatever the tier: everyone else gets 404.
  const archivedExpected = {
    anonymous: 404,
    stranger: 404,
    follower: 404,
    member: 404,
    friendOfOwner: 404,
    friendOfCoOwner: 404,
    owner: 200,
    coOwner: 200,
  };

  async function statuses(id: string) {
    const list: Record<string, number> = {};
    const items: Record<string, number> = {};
    for (const [name, userId] of Object.entries(viewers())) {
      list[name] = (await getWishlist(id, userId)).status;
      items[name] = (await listItems(id, userId)).status;
    }
    return { list, items };
  }

  for (const visibility of ['everyone', 'friends', 'private'] as const) {
    it(`admits the same people to a ${visibility} list and to its items`, async () => {
      const id = await makeList(visibility);
      const { list, items } = await statuses(id);
      expect(list).toEqual(expected[visibility]);
      expect(items).toEqual(expected[visibility]);
    });

    // regression: the items read never checked `archived`, so an archived list's
    // items stayed readable (200) by anyone while the list itself 404'd.
    it(`regression: hides an archived ${visibility} list and its items from every non-owner`, async () => {
      const id = await makeList(visibility, true);
      const { list, items } = await statuses(id);
      expect(list).toEqual(archivedExpected);
      expect(items).toEqual(archivedExpected);
    });
  }

  it('still tells the wishlist read who the viewer is', async () => {
    const id = await makeList('friends');
    const role = async (userId: string) =>
      (await (await getWishlist(id, userId)).json()).data.userRole;
    expect(await role(owner)).toBe('owner');
    expect(await role(coOwner)).toBe('owner');
    expect(await role(member)).toBe('member');
    expect(await role(friendOfOwner)).toBeNull();
  });
});

describe('GET /api/wishlists/[id] — slug backfill on an old list', () => {
  // Saved before slugs existed: no slug. It also lacks `archived`, `currency`
  // and `bannerUrl`, which hydration fills in with their schema defaults, so a
  // write of the whole hydrated doc would show.
  async function oldPrivateList() {
    const { insertedId } = await Wishlist.collection.insertOne({
      name: 'Old list',
      owners: [new mongoose.Types.ObjectId(owner)],
      featuredBy: [],
      visibility: 'private',
      isPublic: false,
    });
    wishlistId = insertedId.toString();
    await WishlistMember.create({ wishlist: insertedId, user: member });
    return insertedId;
  }

  const raw = (id: mongoose.Types.ObjectId) => Wishlist.collection.findOne({ _id: id });

  // regression: the backfill was `wishlist.save()` on the hydrated doc, and that
  // save also stored every schema default hydration had filled in for a field
  // the old list lacked. On a list stored with only `isPublic: false`, one was
  // `visibility: 'everyone'`, which made it public to search, the profile
  // listing and the share card.
  it.each([
    ['an owner', () => owner],
    ['a member', () => member],
  ])('regression: stores only the slug when %s views an old private list', async (_, viewer) => {
    const id = await oldPrivateList();
    const before = await raw(id);

    const res = await getWishlist(wishlistId, viewer());
    expect(res.status).toBe(200);
    const { data } = await res.json();

    const { slug, ...rest } = (await raw(id))!;
    expect(slug).toMatch(/^old-list-[a-z0-9]+$/);
    expect(data.slug).toBe(slug);
    // Nothing else: no schema default is stored, and not even `updatedAt` moves.
    expect(rest).toEqual(before);
    expect(rest).not.toHaveProperty('archived');
    expect(rest).not.toHaveProperty('currency');

    // Still private, by its id and by its new slug.
    expect((await getWishlist(wishlistId, null)).status).toBe(401);
    expect((await getWishlist(slug, stranger)).status).toBe(403);
    expect((await listItems(wishlistId, null)).status).toBe(401);
  });

  // regression: the backfill ran before the access check, so anyone asking for
  // the list, signed out included, triggered the write, refused or not.
  it('regression: writes nothing when the viewer is refused', async () => {
    const id = await oldPrivateList();
    const before = await raw(id);

    expect((await getWishlist(wishlistId, null)).status).toBe(401);
    expect((await getWishlist(wishlistId, stranger)).status).toBe(403);
    expect((await getWishlist(wishlistId, friendOfOwner)).status).toBe(403);

    expect(await raw(id)).toEqual(before);
  });

  // regression: the backfill wrote whatever it generated over the stored slug,
  // so a slug set between its read and its write (an owner choosing the URL in
  // settings, another viewer's backfill) was replaced by a random one.
  it('regression: keeps a slug set while the backfill was generating one', async () => {
    const id = await oldPrivateList();
    vi.mocked(generateUniqueWishlistSlug).mockImplementationOnce(async () => {
      await Wishlist.collection.updateOne({ _id: id }, { $set: { slug: 'chosen-by-owner' } });
      return 'old-list-zzzzz';
    });

    const res = await getWishlist(wishlistId, owner);
    expect(res.status).toBe(200);
    expect((await res.json()).data.slug).toBe('chosen-by-owner');
    expect((await raw(id))?.slug).toBe('chosen-by-owner');
  });
});

describe('GET /api/wishlists/[id]/items — archived lists', () => {
  // regression: an archived `everyone` list keeps isPublic: true, which was all
  // the items read looked at, so its items leaked to anyone with the link.
  it('regression: answers a signed-out viewer, a member and a friend like a missing list', async () => {
    const id = await makeList('everyone', true);
    await makeItem('available');
    const missing = await listItems(missingId(), null);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);

    for (const viewer of [null, member, friendOfOwner]) {
      const res = await listItems(id, viewer);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
  });

  it('still lists an archived list’s items for every owner', async () => {
    const id = await makeList('everyone', true);
    await makeItem('available');
    for (const viewer of [owner, coOwner]) {
      const res = await listItems(id, viewer);
      expect(res.status).toBe(200);
      expect((await res.json()).data.map((i: { name: string }) => i.name)).toEqual([
        'available gift',
      ]);
    }
  });
});

describe('GET /api/wishlists/[id]/items — friends-only lists', () => {
  // regression: a friends list has isPublic: false, so the items read sent a
  // friend who isn't a member through the membership check and 403'd them,
  // although the wishlist read admits them ("Failed to load items").
  it("regression: lists the items for a mutual friend of any owner who isn't a member", async () => {
    const id = await makeList('friends');
    await makeItem('available');
    for (const viewer of [friendOfOwner, friendOfCoOwner]) {
      const res = await listItems(id, viewer);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(1);
    }
  });

  it("refuses someone who isn't a friend of any owner", async () => {
    const id = await makeList('friends');
    await makeItem('available');
    for (const viewer of [stranger, follower]) {
      const res = await listItems(id, viewer);
      expect(res.status).toBe(403);
      expect((await res.json()).data).toBeUndefined();
    }
  });

  it('shows a friend no bookings, drafts or other people’s proposals', async () => {
    const id = await makeList('friends');
    await makeItem('available');
    await makeItem('booked', { bookedBy: member });
    await makeItem('draft');
    await makeItem('proposed', { proposedBy: member });

    const res = await listItems(id, friendOfOwner);
    const data = (await res.json()).data as {
      name: string;
      status: string;
      bookedBy?: string;
      proposedBy?: string;
    }[];
    expect(data.map((i) => i.name).sort()).toEqual(['available gift', 'booked gift']);
    expect(data.every((i) => i.status === 'available')).toBe(true);
    expect(data.every((i) => i.bookedBy === undefined && i.proposedBy === undefined)).toBe(true);
  });
});

describe('POST /api/wishlists/[id]/items — proposing on an archived list', () => {
  // regression: propose never checked `archived`, so a member could still add
  // proposals (and notify the owners) on a list hidden from them.
  it('regression: refuses a member like a missing list, and stores and notifies nothing', async () => {
    const id = await makeList('everyone', true);
    const missing = await propose(missingId(), member);
    expect(missing.status).toBe(404);

    const res = await propose(id, member);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(await missing.json());
    expect(await Item.countDocuments({ wishlist: id })).toBe(0);
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('still lets a member propose once the list is unarchived', async () => {
    const id = await makeList('everyone', true);
    await Wishlist.updateOne({ _id: id }, { $set: { archived: false } });
    expect((await propose(id, member)).status).toBe(201);
  });

  it('still lets an owner add items to an archived list', async () => {
    const id = await makeList('everyone', true);
    expect((await createAsOwner(id)).status).toBe(201);
  });
});

describe('PATCH/DELETE /api/items/[id] — on an archived list', () => {
  // regression: booking never checked `archived`, so a member could still book
  // (and get a Reservation) on a list hidden from them.
  it('regression: refuses a member booking like a missing item, and books nothing', async () => {
    await makeList('everyone', true);
    const itemId = await makeItem('available');
    const missing = await patchItem(missingId(), member, { status: 'booked' });
    expect(missing.status).toBe(404);

    const res = await patchItem(itemId, member, { status: 'booked' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(await missing.json());
    const item = await Item.findById(itemId).lean();
    expect(item?.status).toBe('available');
    expect(item?.bookedBy ?? null).toBeNull();
    expect(await Reservation.countDocuments({})).toBe(0);
  });

  it('refuses unbooking too, and leaves the booking and its reservation as they were', async () => {
    await makeList('everyone');
    const itemId = await makeItem('available');
    expect((await patchItem(itemId, member, { status: 'booked' })).status).toBe(200);
    await Wishlist.updateOne({ _id: wishlistId }, { $set: { archived: true } });

    const res = await patchItem(itemId, member, { status: 'available' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(ITEM_NOT_FOUND);
    const item = await Item.findById(itemId).lean();
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(member);
    expect(await Reservation.countDocuments({ gifter: member, item: itemId })).toBe(1);
  });

  it("refuses a proposer's edit and withdrawal, and keeps the proposal", async () => {
    await makeList('everyone', true);
    const itemId = await makeItem('proposed', { proposedBy: member });

    const edit = await patchItem(itemId, member, { name: 'Renamed' });
    expect(edit.status).toBe(404);
    expect(await edit.json()).toEqual(ITEM_NOT_FOUND);

    const withdraw = await deleteItem(itemId, member);
    expect(withdraw.status).toBe(404);
    expect(await withdraw.json()).toEqual(ITEM_NOT_FOUND);

    const item = await Item.findById(itemId).lean();
    expect(item?.name).toBe('proposed gift');
  });

  it('refuses a stranger like a missing item rather than with a 403', async () => {
    await makeList('everyone', true);
    const itemId = await makeItem('available');
    expect((await patchItem(itemId, stranger, { status: 'booked' })).status).toBe(404);
    expect((await deleteItem(itemId, stranger)).status).toBe(404);
  });

  it('still lets every owner edit and delete items on an archived list', async () => {
    await makeList('everyone', true);
    const itemId = await makeItem('available');
    expect((await patchItem(itemId, coOwner, { name: 'Renamed' })).status).toBe(200);
    expect((await deleteItem(itemId, owner)).status).toBe(200);
    expect(await Item.countDocuments({ _id: itemId })).toBe(0);
  });
});
