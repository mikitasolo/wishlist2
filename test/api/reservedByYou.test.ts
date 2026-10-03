import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET } from '@/app/api/wishlists/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

const session = vi.mocked(auth);

// `reservedByYou` on GET /api/wishlists (WIS-253): on a list shared with you,
// the items you've reserved there yourself. A count of reservations only ever
// goes to the gifter, so a list you own never carries it, and nobody else's
// bookings are counted.

let me: string;
let otherMember: string;
let owner: string;
let coOwner: string;
let sharedId: string;
let quietId: string;
let ownId: string;
let coOwnedId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

async function user(username: string) {
  return (await User.create({ email: `${username}@x.com`, username }))._id.toString();
}

async function items(wishlist: string, ...rows: Record<string, unknown>[]) {
  await Item.create(rows.map((r, i) => ({ wishlist, name: `Item ${i}`, ...r })));
}

async function list(name: string, owners: string[], fields: Record<string, unknown> = {}) {
  const w = await Wishlist.create({
    name,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    owners,
    visibility: 'everyone',
    ...fields,
  });
  return w._id.toString();
}

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  me = await user('me');
  otherMember = await user('othermember');
  owner = await user('owner');
  coOwner = await user('coowner');

  // Someone else's list you're a member of, with another member on it too.
  sharedId = await list('Birthday', [owner]);
  // Another, where you hold nothing.
  quietId = await list('Flat', [owner]);
  await WishlistMember.create([
    { wishlist: sharedId, user: me },
    { wishlist: sharedId, user: otherMember },
    { wishlist: quietId, user: me },
    { wishlist: quietId, user: otherMember },
  ]);
  await items(
    sharedId,
    { status: 'booked', bookedBy: me },
    { status: 'booked', bookedBy: me },
    { status: 'booked', bookedBy: otherMember },
    { status: 'available' },
    // Received: no longer a reservation of yours on the list.
    { status: 'completed' }
  );
  await items(quietId, { status: 'booked', bookedBy: otherMember }, { status: 'available' });

  // Your own list, and one you co-own, each with items reserved by members.
  ownId = await list('Mine', [me]);
  coOwnedId = await list('Ours', [coOwner, me]);
  await WishlistMember.create([
    { wishlist: ownId, user: otherMember },
    { wishlist: coOwnedId, user: otherMember },
  ]);
  await items(ownId, { status: 'booked', bookedBy: otherMember }, { status: 'available' });
  await items(coOwnedId, { status: 'booked', bookedBy: otherMember });
});

type Row = { _id: string; reservedByYou?: number };

async function lists(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
  const res = await GET(new NextRequest('http://localhost/api/wishlists'));
  expect(res.status).toBe(200);
  return (await res.json()).data as { owned: Row[]; member: Row[] };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r._id === id)!;

describe('GET /api/wishlists — reservedByYou', () => {
  it('gives each list shared with you the items you have reserved there', async () => {
    const { member } = await lists(me);
    expect(byId(member, sharedId).reservedByYou).toBe(2);
  });

  it('counts 0 on a shared list where you hold none, though others do', async () => {
    const { member } = await lists(me);
    expect(byId(member, quietId).reservedByYou).toBe(0);
  });

  it("counts only the caller's own reservations, never another member's", async () => {
    // The other member's view of the same lists: their one booking on each.
    const { member } = await lists(otherMember);
    expect(byId(member, sharedId).reservedByYou).toBe(1);
    expect(byId(member, quietId).reservedByYou).toBe(1);
  });

  // regression: owners never see booking status, and a count of reservations
  // only ever goes to the gifter. A list you own (alone or with others) must
  // not carry the field at all, not even as 0, though members hold bookings on it.
  it('regression: never puts the field on a list you own or co-own', async () => {
    const { owned } = await lists(me);
    expect(owned.map((r) => r._id).sort()).toEqual([ownId, coOwnedId].sort());
    for (const row of owned) expect(row).not.toHaveProperty('reservedByYou');

    const asOwner = await lists(owner);
    for (const row of asOwner.owned) expect(row).not.toHaveProperty('reservedByYou');
    expect(asOwner.member).toEqual([]);
  });

  it('leaves an archived list out of Shared altogether, reservations or not', async () => {
    await Wishlist.updateOne({ _id: sharedId }, { archived: true });
    const { member } = await lists(me);
    expect(member.map((r) => r._id)).toEqual([quietId]);
  });
});
