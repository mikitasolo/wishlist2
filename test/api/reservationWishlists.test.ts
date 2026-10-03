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
 * What the Booked page reads of the live list behind each of a gifter's
 * reservations. `GET /api/users/me/reservations` returns its slug, which the
 * card links it by, its occasion, which "To give" is grouped by, and
 * `listOpen`, whether the gifter may open it at all (the card links it only if
 * so). A Reservation outlives the gifter's access to its list, so each is only
 * returned while the gifter may still open that list
 * (`getWishlistViewAccess`'s rules). Otherwise it's `null`. (The gift history
 * reads nothing of the live list: `test/api/reservations.test.ts`.)
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
/** Each list's slug as `list` created it, by id. */
const slugs = new Map<string, string>();
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
  const id = wl._id.toString();
  slugs.set(id, wl.slug!);
  return id;
}

/**
 * `gifter` books an item on the list, as the item route leaves it: item and
 * Reservation. Returns the Reservation's id.
 */
async function book(wishlistId: string, itemName = 'Blue Mug') {
  const item = await Item.create({
    wishlist: wishlistId,
    name: itemName,
    status: 'booked',
    bookedBy: gifter,
  });
  const reservation = await Reservation.create({
    gifter,
    wishlist: wishlistId,
    item: item._id,
    owner,
    itemName,
    wishlistName: 'Birthday',
  });
  return reservation._id.toString();
}

async function befriend(a: string, b: string) {
  await Follow.create([
    { follower: a, following: b },
    { follower: b, following: a },
  ]);
}

/** The gifter's membership goes (they left, or were kicked); their records stay. */
async function removeGifter(wishlistId: string) {
  await WishlistMember.deleteOne({ wishlist: wishlistId, user: gifter });
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

/** An owner renames the list, and gives it a slug to match. */
const rename = (wishlistId: string) =>
  ownerEdits(wishlistId, { name: 'Anna’s 30th', slug: 'annas-30th' });

interface Row {
  itemName: string;
  wishlistId: string | null;
  wishlistSlug: string | null;
  wishlistOccasion?: unknown;
  listOpen?: boolean;
}

/** The gifter's reservations, as the Booked page reads them. */
async function read(userId: string | null = gifter): Promise<Row[]> {
  signIn(userId);
  const res = await LIST_RESERVATIONS();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

/** What the gifter's one reservation comes back with of its live list. */
async function shown() {
  const rows = await read();
  expect(rows).toHaveLength(1);
  return of(rows[0]);
}

/** What a reservation's row says of its live list. */
const of = (row: Row) => ({
  slug: row.wishlistSlug,
  occasion: row.wishlistOccasion,
  listOpen: row.listOpen,
});

/** The list's slug and its (default) occasion, as a gifter who may open it reads them. */
const visible = (wishlistId: string) => ({
  slug: slugs.get(wishlistId),
  occasion: BIRTHDAY,
  listOpen: true,
});
/** Nothing of the live list: the card names it, unlinked, under "No date". */
const HIDDEN = { slug: null, occasion: null, listOpen: false };

describe('GET /api/users/me/reservations — the live list’s slug and occasion', () => {
  it('refuses a signed-out caller', async () => {
    signIn(null);
    expect((await LIST_RESERVATIONS()).status).toBe(401);
  });

  it.each([
    ['a member of a public list', { visibility: 'everyone' }],
    ['a member of a friends-only list', { visibility: 'friends' }],
    ['a member of a private list', { visibility: 'private' }],
  ])('returns them to %s, as stored', async (_label, fields) => {
    const id = await list(fields);
    await book(id);
    expect(await shown()).toEqual(visible(id));
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

    const shownBy = Object.fromEntries((await read()).map((r) => [r.itemName, r.wishlistOccasion]));
    expect(shownBy).toEqual({ Vase: WEDDING, Lamp: null, Rug: null });
  });

  it("returns them to a non-member who can still open the list: a friend of a co-owner's friends-only list", async () => {
    await befriend(gifter, coOwner);
    const id = await list({ visibility: 'friends', member: false });
    await book(id);
    expect(await shown()).toEqual(visible(id));
  });

  // regression: the slug was returned for every reservation's list, whatever
  // the gifter's access to it now, so a gifter who could no longer open a list
  // still read its current slug (and so, roughly, its name) after every rename.
  // It now goes as the occasion does.
  describe('hides them once the gifter can no longer see the list', () => {
    it.each(['private', 'friends'])(
      'from a gifter removed from a %s list, while the reservation stays, renamed or not',
      async (visibility) => {
        const id = await list({ visibility });
        await book(id);
        expect(await shown()).toEqual(visible(id));

        await removeGifter(id);
        expect(await shown()).toEqual(HIDDEN);
        // A rename since doesn't reach them either.
        await rename(id);
        expect(await shown()).toEqual(HIDDEN);
        // The card itself is as before, and links the list by its id.
        const [row] = await read();
        expect(row).toMatchObject({ itemName: 'Blue Mug', wishlistId: id });
      }
    );

    it('but not from one removed from a public list, which they can still open', async () => {
      const id = await list({ visibility: 'everyone' });
      await book(id);
      await removeGifter(id);
      expect(await shown()).toEqual(visible(id));
    });

    it.each(['everyone', 'friends', 'private'])(
      'from a member, once the %s list is archived (owner-only)',
      async (visibility) => {
        const id = await list({ visibility });
        await book(id);
        await ownerEdits(id, { archived: true });
        expect(await shown()).toEqual(HIDDEN);

        // Unarchived, they're back.
        await ownerEdits(id, { archived: false });
        expect(await shown()).toEqual(visible(id));
      }
    );

    it('from a friend who is no member, once the list is made private', async () => {
      await befriend(gifter, owner);
      const id = await list({ visibility: 'friends', member: false });
      await book(id);
      expect(await shown()).toEqual(visible(id));

      await ownerEdits(id, { visibility: 'private' });
      expect(await shown()).toEqual(HIDDEN);
    });

    it('from a former member, once a public list is made private', async () => {
      const id = await list({ visibility: 'everyone', member: false });
      await book(id);
      expect(await shown()).toEqual(visible(id));

      await ownerEdits(id, { visibility: 'private' });
      expect(await shown()).toEqual(HIDDEN);
    });

    it('from a friend, once the friendship ends', async () => {
      await befriend(gifter, owner);
      const id = await list({ visibility: 'friends', member: false });
      await book(id);
      expect(await shown()).toEqual(visible(id));

      await Follow.deleteOne({ follower: owner, following: gifter });
      expect(await shown()).toEqual(HIDDEN);
    });
  });

  it('returns no slug and no occasion for a reservation whose list was deleted', async () => {
    const id = await list();
    await book(id);
    await Wishlist.deleteOne({ _id: id });

    const [row] = await read();
    expect(row).toMatchObject({
      wishlistId: id,
      listOpen: false,
      wishlistSlug: null,
      wishlistOccasion: null,
    });
  });

  // A list made before slugs existed, which no viewer has opened since (the
  // list read backfills one): open to the gifter, so the card links it by id.
  it('says a list with no slug yet is open, so the card links it by its id', async () => {
    const id = await list();
    await Wishlist.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $unset: { slug: '' } }
    );
    await book(id);
    expect(await shown()).toEqual({ slug: null, occasion: BIRTHDAY, listOpen: true });
  });

  it('reads them live: a rename, or a changed or cleared date, shows on the next read', async () => {
    const id = await list();
    await book(id);
    expect(await shown()).toEqual(visible(id));

    await rename(id);
    expect(await shown()).toEqual({ slug: 'annas-30th', occasion: BIRTHDAY, listOpen: true });

    await ownerEdits(id, { occasion: WEDDING });
    expect(await shown()).toEqual({ slug: 'annas-30th', occasion: WEDDING, listOpen: true });

    await ownerEdits(id, { occasion: null });
    expect(await shown()).toEqual({ slug: 'annas-30th', occasion: null, listOpen: true });

    // Nothing was copied into the Reservation.
    const stored = await Reservation.findOne({ gifter }).lean();
    expect(stored).not.toHaveProperty('slug');
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

/**
 * Every query a read sends, by collection. Index builds are left out: the
 * models' `autoIndex` sends them in the background, whenever they happen to
 * run.
 */
async function countQueries<T>(readIt: () => Promise<T>) {
  const ops: Record<string, number> = {};
  mongoose.set('debug', (collection: string, method: string) => {
    if (/index/i.test(method)) return;
    ops[collection] = (ops[collection] ?? 0) + 1;
  });
  try {
    const rows = await readIt();
    return { rows, ops };
  } finally {
    mongoose.set('debug', false);
  }
}

/**
 * Six more records, by `record`, on five lists of every visibility and
 * relationship, after an `Item 0` on a friend's friends-only list. The gifter
 * may no longer open the lists of these two.
 */
const HIDDEN_FROM_GIFTER = ['Item 3', 'Item 4'];
async function recordOnManyLists(record: (wishlistId: string, itemName: string) => unknown) {
  await record(await list({ visibility: 'everyone' }), 'Item 1');
  await record(await list({ visibility: 'private' }), 'Item 2');
  await record(await list({ visibility: 'private', member: false }), 'Item 3');
  await record(await list({ visibility: 'friends', archived: true }), 'Item 4');
  const shared = await list({ visibility: 'friends' });
  await record(shared, 'Item 5');
  await record(shared, 'Item 6');
}

describe('GET /api/users/me/reservations — query count', () => {
  afterEach(() => {
    mongoose.set('debug', false);
  });

  it('reads the wishlists in one query, however many reservations there are', async () => {
    await befriend(gifter, owner);
    await book(await list({ visibility: 'friends', member: false }), 'Item 0');
    const one = await countQueries(() => read());
    expect(one.rows).toHaveLength(1);
    expect(one.ops[Wishlist.collection.collectionName]).toBe(1);

    await recordOnManyLists(book);
    const many = await countQueries(() => read());
    expect(many.rows).toHaveLength(7);
    expect(many.ops[Wishlist.collection.collectionName]).toBe(1);
    // And nothing else grows with them either: no access check per list.
    expect(many.ops).toEqual(one.ops);

    // The single query still told the lists apart.
    const byItem = (f: (r: Row) => unknown) =>
      Object.fromEntries(many.rows.map((r) => [r.itemName, f(r)]));
    expect(byItem(of)).toEqual(
      byItem((r) => (HIDDEN_FROM_GIFTER.includes(r.itemName) ? HIDDEN : visible(r.wishlistId!)))
    );
  });

  it('sends no wishlist query when there are no reservations', async () => {
    const { rows, ops } = await countQueries(() => read());
    expect(rows).toEqual([]);
    expect(ops[Wishlist.collection.collectionName]).toBeUndefined();
  });
});
