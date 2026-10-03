import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// /api/users/me/items reads the rates for its price sort.
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as DASHBOARD_LISTS } from '@/app/api/wishlists/route';
import { GET as PROFILE_LISTS } from '@/app/api/users/[id]/wishlists/route';
import { GET as MY_ITEMS } from '@/app/api/users/me/items/route';
import { countVisibleItems } from '@/lib/og/data';
import { countWishlistItems, countsFor } from '@/lib/utils/wishlistItemCounts';
import { sumItemCounts, tallyItems } from '@/lib/utils/itemCounts';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

const session = vi.mocked(auth);

// One list as the audit found it (WIS-229): its card said 15 items to its owner,
// 11 on the profile and the share card, and a member's count took in every
// proposal. 4 published (one of them booked), 2 drafts, 2 proposals, by two
// different members.
const PUBLISHED = 4;
const DRAFTS = 2;
const PROPOSALS = 2;

let owner: string;
let coOwner: string;
let member: string;
let otherMember: string;
let stranger: string;
let listId: string;
let archivedId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

async function user(username: string) {
  return (await User.create({ email: `${username}@x.com`, username }))._id.toString();
}

function signIn(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

async function items(wishlist: string, ...rows: Record<string, unknown>[]) {
  await Item.create(rows.map((r, i) => ({ wishlist, name: `Item ${i}`, ...r })));
}

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  owner = await user('owner');
  coOwner = await user('coowner');
  member = await user('member');
  otherMember = await user('othermember');
  stranger = await user('stranger');

  const list = await Wishlist.create({
    name: 'Birthday',
    slug: 'birthday',
    owners: [owner, coOwner],
    visibility: 'everyone',
  });
  listId = list._id.toString();
  await WishlistMember.create([
    { wishlist: list._id, user: member },
    { wishlist: list._id, user: otherMember },
  ]);
  await items(
    listId,
    { status: 'available' },
    { status: 'available' },
    { status: 'booked', bookedBy: member },
    { status: 'completed' },
    { status: 'draft' },
    { status: 'draft' },
    { status: 'proposed', proposedBy: member },
    { status: 'proposed', proposedBy: otherMember }
  );

  const archived = await Wishlist.create({
    name: 'Old flat',
    slug: 'old-flat',
    owners: [owner],
    visibility: 'everyone',
    archived: true,
  });
  archivedId = archived._id.toString();
  await items(archivedId, { status: 'available' }, { status: 'available' }, { status: 'draft' });
});

type ListRow = { _id: string; itemCount: number; draftCount?: number; proposalCount?: number };

async function dashboard(userId: string) {
  signIn(userId);
  const res = await DASHBOARD_LISTS(new NextRequest('http://localhost/api/wishlists'));
  expect(res.status).toBe(200);
  return (await res.json()).data as { owned: ListRow[]; member: ListRow[] };
}

async function profileLists(profileOf: string, viewer: string | null) {
  signIn(viewer);
  const res = await PROFILE_LISTS(
    new NextRequest(`http://localhost/api/users/${profileOf}/wishlists`),
    { params: Promise.resolve({ id: profileOf }) }
  );
  expect(res.status).toBe(200);
  return (await res.json()).data as ListRow[];
}

async function myItems(userId: string, query = '') {
  signIn(userId);
  const res = await MY_ITEMS(new NextRequest(`http://localhost/api/users/me/items${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    data: { status: string; wishlistId: string; wishlistArchived: boolean }[];
    archivedItems: number;
  };
}

const find = (rows: ListRow[], id: string) => rows.find((r) => r._id === id);
// What a response says about bookings, by any name.
const bookingKeys = (row: object) => Object.keys(row).filter((k) => /book|reserv/i.test(k));

describe('countWishlistItems', () => {
  it('counts published items, drafts and proposals per list, and zeros for a list with none', async () => {
    const empty = await Wishlist.create({ name: 'Empty', owners: [owner] });
    const ids = [listId, archivedId].map((id) => new mongoose.Types.ObjectId(id));
    const counts = await countWishlistItems([...ids, empty._id]);

    expect(countsFor(counts, listId)).toEqual({
      items: PUBLISHED,
      drafts: DRAFTS,
      proposals: PROPOSALS,
    });
    expect(countsFor(counts, archivedId)).toEqual({ items: 2, drafts: 1, proposals: 0 });
    expect(countsFor(counts, empty._id)).toEqual({ items: 0, drafts: 0, proposals: 0 });
  });

  it('answers an empty map for no lists', async () => {
    expect((await countWishlistItems([])).size).toBe(0);
  });
});

describe('GET /api/wishlists — the dashboard', () => {
  it('gives each owner the published count, with the drafts and proposals beside it', async () => {
    for (const who of [owner, coOwner]) {
      const row = find((await dashboard(who)).owned, listId)!;
      expect(row.itemCount).toBe(PUBLISHED);
      expect(row.draftCount).toBe(DRAFTS);
      expect(row.proposalCount).toBe(PROPOSALS);
      // Booked folds into the count: nothing says how much is reserved.
      expect(bookingKeys(row)).toEqual([]);
    }
  });

  // regression: a member's count was every item but the drafts, so it took in
  // every member's proposal, which a member is never shown.
  it("regression: gives a member the published count, without anyone's proposals or the drafts", async () => {
    for (const [who, ownBookings] of [
      [member, 1],
      [otherMember, 0],
    ] as const) {
      const row = find((await dashboard(who)).member, listId)!;
      expect(row.itemCount).toBe(PUBLISHED);
      expect(row).not.toHaveProperty('draftCount');
      expect(row).not.toHaveProperty('proposalCount');
      // The only booking count is their own (WIS-253): the list's one booked
      // item is `member`'s, so it's 1 for them and 0 for anyone else.
      expect(bookingKeys(row)).toEqual(['reservedByYou']);
      expect(row).toHaveProperty('reservedByYou', ownBookings);
    }
  });

  it('still counts an archived list for its owner', async () => {
    const row = find((await dashboard(owner)).owned, archivedId)!;
    expect(row).toMatchObject({ itemCount: 2, draftCount: 1, proposalCount: 0 });
  });
});

describe('GET /api/users/[id]/wishlists — a profile', () => {
  it('shows the same published count to the owner, a member and anyone else', async () => {
    for (const viewer of [owner, coOwner, member, stranger, null]) {
      const row = find(await profileLists(owner, viewer), listId)!;
      expect(row.itemCount).toBe(PUBLISHED);
      expect(row).not.toHaveProperty('draftCount');
      expect(row).not.toHaveProperty('proposalCount');
    }
  });
});

describe('one list, every screen', () => {
  // regression: the dashboard counted every item of an owner's list (15), the
  // profile and the share card only its published ones (11).
  it("regression: counts it the same on each owner's dashboard, a member's, every profile and the share card", async () => {
    const counts = [
      find((await dashboard(owner)).owned, listId)!.itemCount,
      find((await dashboard(coOwner)).owned, listId)!.itemCount,
      find((await dashboard(member)).member, listId)!.itemCount,
      find(await profileLists(owner, stranger), listId)!.itemCount,
      find(await profileLists(coOwner, member), listId)!.itemCount,
      find(await profileLists(owner, null), listId)!.itemCount,
      await countVisibleItems(listId),
    ];
    expect(counts).toEqual(counts.map(() => PUBLISHED));
  });
});

describe('GET /api/users/me/items — the items page', () => {
  // regression: it read every list the caller owns, archived ones included, so
  // its total (68) disagreed with the dashboard's (65).
  it('regression: leaves archived lists out by default, and says how many items they hold', async () => {
    const { data, archivedItems } = await myItems(owner);

    expect(data.map((i) => i.wishlistId)).toEqual(data.map(() => listId));
    expect(data).toHaveLength(PUBLISHED + DRAFTS + PROPOSALS);
    expect(data.every((i) => i.wishlistArchived === false)).toBe(true);
    expect(archivedItems).toBe(3);
  });

  it('includes archived lists when asked, marked as such', async () => {
    const { data, archivedItems } = await myItems(owner, '?includeArchived=true');

    expect(data.filter((i) => i.wishlistId === listId)).toHaveLength(8);
    const archived = data.filter((i) => i.wishlistId === archivedId);
    expect(archived).toHaveLength(3);
    expect(archived.every((i) => i.wishlistArchived)).toBe(true);
    expect(archivedItems).toBe(3);
  });

  it('says there is nothing archived to show when the archived lists hold no items', async () => {
    await Item.deleteMany({ wishlist: archivedId });
    expect((await myItems(owner)).archivedItems).toBe(0);
  });

  it('only takes "true" as asking for them', async () => {
    for (const query of ['?includeArchived=1', '?includeArchived=false', '?includeArchived=']) {
      const { data } = await myItems(owner, query);
      expect(data.some((i) => i.wishlistId === archivedId)).toBe(false);
    }
  });

  it("counts what the dashboard counts across the owner's active lists", async () => {
    const lists = (await dashboard(owner)).owned.filter((w) => w._id !== archivedId);
    const onDashboard = sumItemCounts(
      lists.map((w) => ({ items: w.itemCount, drafts: w.draftCount, proposals: w.proposalCount }))
    );
    const onItemsPage = tallyItems((await myItems(owner)).data);

    expect(onItemsPage).toEqual(onDashboard);
    expect(onItemsPage).toEqual({ items: PUBLISHED, drafts: DRAFTS, proposals: PROPOSALS });
  });

  it('never shows an owner a booking', async () => {
    const { data } = await myItems(owner, '?includeArchived=true');
    expect(data.map((i) => i.status)).not.toContain('booked');
  });

  it("gives someone who owns no list nothing, whatever lists they're a member of", async () => {
    expect(await myItems(member, '?includeArchived=true')).toEqual({
      success: true,
      data: [],
      archivedItems: 0,
    });
  });
});
