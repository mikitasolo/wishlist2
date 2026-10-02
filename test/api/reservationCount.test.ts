import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as COUNT } from '@/app/api/users/me/reservations/count/route';
import { GET as LIST } from '@/app/api/users/me/reservations/route';
import { partitionReservations, type ReservationStatusInfo } from '@/lib/utils/reservations';
import User from '@/models/User';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

/**
 * `GET /api/users/me/reservations/count` is the dashboard's "Reserved by you"
 * tile. It must say what the Booked page's list (`GET /api/users/me/
 * reservations`) would, both its sections together: the gifts still reserved
 * and the ones that need confirmation, whatever detached them from their item.
 * Only the cost differs: one count, not the list's reads of the live items and
 * lists.
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

/** What the dashboard reads for `userId`. */
async function count(userId: string = gifter): Promise<number> {
  signIn(userId);
  const res = await COUNT();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data.count;
}

/** What the Booked page reads for `userId`. */
async function listed(userId: string = gifter): Promise<ReservationStatusInfo[]> {
  signIn(userId);
  const res = await LIST();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe('GET /api/users/me/reservations/count', () => {
  it('refuses a signed-out caller', async () => {
    signIn(null);
    const res = await COUNT();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('is 0 when the caller holds no reservations, as the list is empty', async () => {
    expect(await count()).toBe(0);
    expect(await listed()).toEqual([]);
  });

  it('counts every reservation the Booked page lists, the ones that need confirmation too', async () => {
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
    // And the owner deleted this one, items and all.
    const deleted = await list();
    await Item.findByIdAndDelete(await book(deleted, gifter, 'On a deleted list'));
    await Wishlist.findByIdAndDelete(deleted);

    const rows = await listed();
    const { active, needsConfirm } = partitionReservations(rows);
    expect(active).toHaveLength(3); // the archived list's booking still stands
    expect(needsConfirm).toHaveLength(7);
    expect(await count()).toBe(rows.length);
    expect(rows).toHaveLength(10);
  });

  it("counts only the caller's own reservations", async () => {
    const id = await list();
    await book(id, gifter);
    // Someone else's, on the same list and on another, one of them detached.
    await book(id, other, 'Theirs');
    await Item.findByIdAndDelete(await book(await list(), other, 'Theirs, removed'));

    expect(await count(gifter)).toBe(1);
    expect(await count(other)).toBe(2);
    // The owner holds none: their list's bookings are never theirs to count.
    expect(await count(owner)).toBe(0);
    for (const who of [gifter, other, owner]) {
      expect(await count(who)).toBe((await listed(who)).length);
    }
  });

  it('sends one count of the reservations and no other query, however many there are', async () => {
    const id = await list();
    for (let i = 0; i < 5; i += 1) await book(id, gifter, `Item ${i}`);
    await book(await list({ archived: true }), gifter, 'On an archived list');

    // Every query the read sends, as `collection.method`. Index builds are left
    // out: the models' `autoIndex` sends them in the background.
    const queries: string[] = [];
    mongoose.set('debug', (collection: string, method: string) => {
      if (!/index/i.test(method)) queries.push(`${collection}.${method}`);
    });
    const n = await count();
    mongoose.set('debug', false);

    expect(n).toBe(6);
    expect(queries).toEqual([`${Reservation.collection.collectionName}.countDocuments`]);
  });
});
