import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as SUMMARY } from '@/app/api/users/me/reservations/summary/route';
import { GET as LIST } from '@/app/api/users/me/reservations/route';
import { partitionReservations, type ReservationStatusInfo } from '@/lib/utils/reservations';
import User from '@/models/User';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

/**
 * `GET /api/users/me/reservations/summary` is the dashboard's "N reservations
 * changed" (WIS-252). `changed` must be exactly the Booked page's "Needs your
 * confirmation" section (`GET /api/users/me/reservations`, split by
 * `partitionReservations`), whatever detached a reservation from its item or
 * its list, and only ever the caller's own: a count of reservations goes to
 * the gifter alone, never to an owner or anyone else.
 */

const session = vi.mocked(auth);

let owner: string;
let gifter: string;
let other: string;

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
  gifter = await user('gifter');
  other = await user('other');
});

afterEach(() => {
  mongoose.set('debug', false);
});

function signIn(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

let lists = 0;
/** A list of `owner`'s with `gifter` and `other` as members. */
async function list(fields: Record<string, unknown> = {}) {
  lists += 1;
  const wl = await Wishlist.create({
    name: `List ${lists}`,
    slug: `list-${lists}`,
    owners: [owner],
    visibility: 'everyone',
    ...fields,
  });
  await WishlistMember.create([
    { wishlist: wl._id, user: gifter },
    { wishlist: wl._id, user: other },
  ]);
  return wl._id.toString();
}

/**
 * `by` books an item on the list, as the item route leaves it: the item and
 * its Reservation. Returns the item's id, for the cases to change it after.
 */
async function book(wishlistId: string, by = gifter, itemName = 'Blue Mug') {
  const item = await Item.create({
    wishlist: wishlistId,
    name: itemName,
    status: 'booked',
    bookedBy: by,
  });
  await Reservation.create({
    gifter: by,
    wishlist: wishlistId,
    item: item._id,
    owner,
    itemName,
    wishlistName: 'Birthday',
  });
  return item._id.toString();
}

/** What the dashboard reads for `userId`: the whole answer, which is only the count. */
async function summary(userId: string = gifter): Promise<{ changed: number }> {
  signIn(userId);
  const res = await SUMMARY();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

const changed = async (userId: string = gifter) => (await summary(userId)).changed;

/** What the Booked page reads for `userId`. */
async function listed(userId: string = gifter): Promise<ReservationStatusInfo[]> {
  signIn(userId);
  const res = await LIST();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

const needsConfirm = async (userId: string = gifter) =>
  partitionReservations(await listed(userId)).needsConfirm.length;

describe('GET /api/users/me/reservations/summary', () => {
  it('refuses a signed-out caller', async () => {
    signIn(null);
    const res = await SUMMARY();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('is 0 when the caller holds no reservations, as the list is empty', async () => {
    expect(await summary()).toEqual({ changed: 0 });
    expect(await listed()).toEqual([]);
  });

  it('is 0 while every reservation still stands', async () => {
    const id = await list();
    await book(id, gifter, 'One');
    await book(await list(), gifter, 'Two');
    expect(await changed()).toBe(0);
    expect(await needsConfirm()).toBe(0);
  });

  it('counts exactly the reservations the Booked page says need confirmation', async () => {
    // Still reserved, on two lists.
    const birthday = await list();
    await book(birthday, gifter, 'Still mine');
    await book(await list(), gifter, 'Also still mine');

    // Each way a reservation comes apart from its item, and stays.
    await Item.findByIdAndDelete(await book(birthday, gifter, 'Removed by the owner'));
    for (const status of ['completed', 'draft', 'available'] as const) {
      await Item.findByIdAndUpdate(await book(birthday, gifter, `Now ${status}`), {
        status,
        bookedBy: null,
      });
    }
    await Item.findByIdAndUpdate(await book(birthday, gifter, 'Taken by someone else'), {
      bookedBy: other,
    });
    // The gifter left this list (their booking freed), and the owner archived that one.
    const left = await list();
    await Item.findByIdAndUpdate(await book(left, gifter, 'On a list they left'), {
      status: 'available',
      bookedBy: null,
    });
    await WishlistMember.deleteOne({ wishlist: left, user: gifter });
    await book(await list({ archived: true }), gifter, 'On an archived list');
    // Still theirs, on a list they can no longer open: made invite-only after they left.
    const closed = await list();
    await book(closed, gifter, 'On a list closed to them');
    await WishlistMember.deleteOne({ wishlist: closed, user: gifter });
    await Wishlist.findByIdAndUpdate(closed, { visibility: 'private', isPublic: false });
    // And the owner deleted this one, items and all.
    const deleted = await list();
    await Item.findByIdAndDelete(await book(deleted, gifter, 'On a deleted list'));
    await Wishlist.findByIdAndDelete(deleted);

    const rows = await listed();
    expect(rows).toHaveLength(11);
    const { active, needsConfirm: confirm } = partitionReservations(rows);
    expect(active).toHaveLength(2);
    expect(confirm).toHaveLength(9);
    expect(await changed()).toBe(confirm.length);
  });

  it("counts only the caller's own reservations, and reaches nobody else", async () => {
    const id = await list();
    await book(id, gifter);
    // Someone else's, on the same list and on another, one of each detached.
    await book(id, other, 'Theirs');
    await Item.findByIdAndDelete(await book(await list(), other, 'Theirs, removed'));
    await Item.findByIdAndDelete(await book(id, gifter, 'Mine, removed'));

    expect(await changed(gifter)).toBe(1);
    expect(await changed(other)).toBe(1);
    // The owner holds none: no count of their lists' bookings ever reaches them,
    // not even the ones whose items they removed.
    expect(await summary(owner)).toEqual({ changed: 0 });
    for (const who of [gifter, other, owner]) {
      expect(await changed(who)).toBe(await needsConfirm(who));
    }
  });

  it('reads in a fixed number of queries however many reservations there are', async () => {
    const queriesFor = async () => {
      const queries: string[] = [];
      mongoose.set('debug', (collection: string, method: string) => {
        if (!/index/i.test(method)) queries.push(`${collection}.${method}`);
      });
      await changed();
      mongoose.set('debug', false);
      return queries.length;
    };

    const id = await list();
    await book(id, gifter, 'Item 0');
    const few = await queriesFor();
    for (let i = 1; i < 6; i += 1) await book(await list(), gifter, `Item ${i}`);
    expect(await queriesFor()).toBe(few);
  });
});
