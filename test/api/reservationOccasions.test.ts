import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as LIST_RESERVATIONS } from '@/app/api/users/me/reservations/route';
import { PATCH } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

/**
 * `GET /api/users/me/reservations` returns each reservation's live list's
 * occasion, which the Booked page groups "To give" by. A Reservation outlives
 * the gifter's access to its list, so the occasion is only returned while the
 * gifter may still open that list (`getWishlistViewAccess`'s rules).
 */

const session = vi.mocked(auth);

// A yearly occasion as stored: on the placeholder year.
const BIRTHDAY = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' } as const;
const WEDDING = { kind: 'wedding', date: '2027-06-12', recurrence: null } as const;

let owner: string;
let coOwner: string;
let gifter: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

async function user(username: string) {
  const u = await User.create({ email: `${username}@x.com`, username });
  return u._id.toString();
}

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  owner = await user('owner');
  coOwner = await user('coowner');
  gifter = await user('gifter');
});

function signIn(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

let lists = 0;
/** A list of `owner` and `coOwner` with `gifter` as a member (unless `member: false`). */
async function list({ member = true, ...fields }: Record<string, unknown> = {}) {
  lists += 1;
  const wl = await Wishlist.create({
    name: `List ${lists}`,
    slug: `list-${lists}`,
    owners: [owner, coOwner],
    visibility: 'everyone',
    occasion: BIRTHDAY,
    ...fields,
  });
  if (member) await WishlistMember.create({ wishlist: wl._id, user: gifter });
  return wl._id.toString();
}

/** `gifter` books an item on the list, as the item route leaves it: item and Reservation. */
async function book(wishlistId: string, itemName = 'Blue Mug') {
  const item = await Item.create({
    wishlist: wishlistId,
    name: itemName,
    status: 'booked',
    bookedBy: gifter,
  });
  await Reservation.create({
    gifter,
    wishlist: wishlistId,
    item: item._id,
    owner,
    itemName,
    wishlistName: 'Birthday',
  });
}

async function befriend(a: string, b: string) {
  await Follow.create([
    { follower: a, following: b },
    { follower: b, following: a },
  ]);
}

/** The owner's settings edit, as the settings form sends it. */
async function ownerEdits(wishlistId: string, body: Record<string, unknown>) {
  signIn(owner);
  const res = await PATCH(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: wishlistId }) }
  );
  expect(res.status).toBe(200);
}

interface Row {
  itemName: string;
  wishlistId: string;
  wishlistSlug: string | null;
  wishlistOccasion: unknown;
}

/** The gifter's reservations, as the Booked page reads them. */
async function read(userId: string | null = gifter): Promise<Row[]> {
  signIn(userId);
  const res = await LIST_RESERVATIONS();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

/** The occasion the gifter's one reservation comes back with. */
async function occasionShown() {
  const rows = await read();
  expect(rows).toHaveLength(1);
  return rows[0].wishlistOccasion;
}

describe('GET /api/users/me/reservations — the live list’s occasion', () => {
  it('refuses a signed-out caller', async () => {
    signIn(null);
    expect((await LIST_RESERVATIONS()).status).toBe(401);
  });

  it.each([
    ['a member of a public list', { visibility: 'everyone' }],
    ['a member of a friends-only list', { visibility: 'friends' }],
    ['a member of a private list', { visibility: 'private' }],
  ])('returns it to %s, as stored', async (_label, fields) => {
    await book(await list(fields));
    expect(await occasionShown()).toEqual(BIRTHDAY);
  });

  it('returns a one-off occasion with its year, and null for a list with none', async () => {
    await book(await list({ occasion: WEDDING }), 'Vase');
    await book(await list({ occasion: null }), 'Lamp');
    // A list saved before occasions existed has no field at all.
    const legacy = await list();
    await Wishlist.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(legacy) },
      { $unset: { occasion: '' } }
    );
    await book(legacy, 'Rug');

    const shown = Object.fromEntries((await read()).map((r) => [r.itemName, r.wishlistOccasion]));
    expect(shown).toEqual({ Vase: WEDDING, Lamp: null, Rug: null });
  });

  it("returns it to a non-member who can still open the list: a friend of a co-owner's friends-only list", async () => {
    await befriend(gifter, coOwner);
    await book(await list({ visibility: 'friends', member: false }));
    expect(await occasionShown()).toEqual(BIRTHDAY);
  });

  describe('hides it once the gifter can no longer see the list', () => {
    it.each(['private', 'friends'])(
      'from a gifter removed from a %s list, while the reservation stays',
      async (visibility) => {
        const id = await list({ visibility });
        await book(id);
        expect(await occasionShown()).toEqual(BIRTHDAY);

        // Left, or kicked: the membership goes, the Reservation stays.
        await WishlistMember.deleteOne({ wishlist: id, user: gifter });
        const [row] = await read();
        expect(row.wishlistOccasion).toBeNull();
        // The card itself, and its link, are as before.
        expect(row.wishlistId).toBe(id);
        expect(row.wishlistSlug).toMatch(/^list-/);
      }
    );

    it('but not from one removed from a public list, which they can still open', async () => {
      const id = await list({ visibility: 'everyone' });
      await book(id);
      await WishlistMember.deleteOne({ wishlist: id, user: gifter });
      expect(await occasionShown()).toEqual(BIRTHDAY);
    });

    it.each(['everyone', 'friends', 'private'])(
      'from a member, once the %s list is archived (owner-only)',
      async (visibility) => {
        const id = await list({ visibility });
        await book(id);
        await ownerEdits(id, { archived: true });

        const [row] = await read();
        expect(row.wishlistOccasion).toBeNull();
        expect(row.wishlistSlug).toMatch(/^list-/);

        // Unarchived, it's back.
        await ownerEdits(id, { archived: false });
        expect(await occasionShown()).toEqual(BIRTHDAY);
      }
    );

    it('from a friend who is no member, once the list is made private', async () => {
      await befriend(gifter, owner);
      const id = await list({ visibility: 'friends', member: false });
      await book(id);
      expect(await occasionShown()).toEqual(BIRTHDAY);

      await ownerEdits(id, { visibility: 'private' });
      expect(await occasionShown()).toBeNull();
    });

    it('from a former member, once a public list is made private', async () => {
      const id = await list({ visibility: 'everyone', member: false });
      await book(id);
      expect(await occasionShown()).toEqual(BIRTHDAY);

      await ownerEdits(id, { visibility: 'private' });
      expect(await occasionShown()).toBeNull();
    });

    it('from a friend, once the friendship ends', async () => {
      await befriend(gifter, owner);
      await book(await list({ visibility: 'friends', member: false }));
      expect(await occasionShown()).toEqual(BIRTHDAY);

      await Follow.deleteOne({ follower: owner, following: gifter });
      expect(await occasionShown()).toBeNull();
    });
  });

  it('returns no slug and no occasion for a reservation whose list was deleted', async () => {
    const id = await list();
    await book(id);
    await Wishlist.deleteOne({ _id: id });

    const [row] = await read();
    expect(row).toMatchObject({ wishlistId: id, wishlistSlug: null, wishlistOccasion: null });
  });

  it('reads the occasion live: a changed or cleared date shows on the next read', async () => {
    const id = await list();
    await book(id);
    expect(await occasionShown()).toEqual(BIRTHDAY);

    await ownerEdits(id, { occasion: WEDDING });
    expect(await occasionShown()).toEqual(WEDDING);

    await ownerEdits(id, { occasion: null });
    expect(await occasionShown()).toBeNull();

    // Nothing was copied into the Reservation.
    const stored = await Reservation.findOne({ gifter }).lean();
    expect(stored).not.toHaveProperty('occasion');
    expect(stored).not.toHaveProperty('wishlistOccasion');
  });

  it("gives the gifter only their own reservations' lists", async () => {
    const other = await user('other');
    const id = await list();
    await book(id);
    await WishlistMember.create({ wishlist: id, user: other });

    expect(await read(other)).toEqual([]);
  });
});

describe('GET /api/users/me/reservations — query count', () => {
  /**
   * Every query the read sends, by collection. Index builds are left out: the
   * models' `autoIndex` sends them in the background, whenever they happen to
   * run.
   */
  async function countQueries() {
    const ops: Record<string, number> = {};
    mongoose.set('debug', (collection: string, method: string) => {
      if (/index/i.test(method)) return;
      ops[collection] = (ops[collection] ?? 0) + 1;
    });
    try {
      const rows = await read();
      return { rows, ops };
    } finally {
      mongoose.set('debug', false);
    }
  }

  afterEach(() => {
    mongoose.set('debug', false);
  });

  it('reads the wishlists in one query, however many reservations there are', async () => {
    await befriend(gifter, owner);
    await book(await list({ visibility: 'friends', member: false }), 'Item 0');
    const one = await countQueries();
    expect(one.rows).toHaveLength(1);
    expect(one.ops[Wishlist.collection.collectionName]).toBe(1);

    // Five more, each on a list of its own, in every visibility and relationship.
    await book(await list({ visibility: 'everyone' }), 'Item 1');
    await book(await list({ visibility: 'private' }), 'Item 2');
    await book(await list({ visibility: 'private', member: false }), 'Item 3');
    await book(await list({ visibility: 'friends', archived: true }), 'Item 4');
    const shared = await list({ visibility: 'friends' });
    await book(shared, 'Item 5');
    await book(shared, 'Item 6');
    const many = await countQueries();
    expect(many.rows).toHaveLength(7);
    expect(many.ops[Wishlist.collection.collectionName]).toBe(1);
    // And nothing else grows with them either: no access check per list.
    expect(many.ops).toEqual(one.ops);

    // The single query still told the lists apart.
    const shown = Object.fromEntries(many.rows.map((r) => [r.itemName, r.wishlistOccasion]));
    expect(shown).toEqual({
      'Item 0': BIRTHDAY,
      'Item 1': BIRTHDAY,
      'Item 2': BIRTHDAY,
      'Item 3': null,
      'Item 4': null,
      'Item 5': BIRTHDAY,
      'Item 6': BIRTHDAY,
    });
  });

  it('sends no wishlist query when there are no reservations', async () => {
    const { rows, ops } = await countQueries();
    expect(rows).toEqual([]);
    expect(ops[Wishlist.collection.collectionName]).toBeUndefined();
  });
});
