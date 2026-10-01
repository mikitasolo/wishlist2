import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// A member's book or unbook decides on the item as the route first read it, so
// it must only be written if the item is still that way when the write lands.
// Each race below holds the member's item write while a concurrent change runs
// to completion, then lets it through: the order a real race only hits by luck.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records copies and deletions instead of performing them, so a
// test can tell which bookings snapshotted the item's image and what was freed.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const isSnapshot = (url: string | null | undefined) => !!url?.startsWith(`${HOST}/snapshots/`);

let owner: string;
let alice: string;
let bob: string;
let itemId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  copy.mockReset();
  copy.mockImplementation(async (_from: string, to: string) => ({ url: `${HOST}/${to}` }));
  const [o, a, b] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
  ]);
  [owner, alice, bob] = [o, a, b].map((u) => u._id.toString());
  const wl = await Wishlist.create({ name: 'Birthday', owners: [o._id], visibility: 'everyone' });
  await WishlistMember.create([
    { wishlist: wl._id, user: a._id },
    { wishlist: wl._id, user: b._id },
  ]);
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Blue Mug',
    imageUrl: `${HOST}/uploads/${owner}/image-abc.jpg`,
  });
  itemId = item._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// `auth()` is the first thing the handler calls, synchronously on invocation, so
// a one-shot session is consumed by this call even while another is in flight.
function patchAs(user: string, body: unknown) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: itemId }) });
}

/**
 * Hold the next item write (the request under test's book or unbook, after all
 * its reads and checks) while `meanwhile` runs to completion, then let it land.
 */
const whileItemWriteHeld = <T>(meanwhile: () => Promise<T>) =>
  holdFirstCall(Item, 'findOneAndUpdate', meanwhile);

describe('PATCH /api/items/[id] — a book or unbook racing another change', () => {
  // regression: both bookings read the item as available and wrote it
  // unconditionally, so both got a 200 and a Reservation, and the item ended up
  // booked by whoever wrote last. The other member was left holding a
  // Reservation for an item booked by someone else, which they couldn't unbook.
  it('regression: of two members booking at once, the first to write keeps it, and the other gets a 409 and no reservation', async () => {
    const race = whileItemWriteHeld(() => patchAs(bob, { status: 'booked' }));
    const alices = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(alices.status).toBe(409);
    expect(await alices.json()).toEqual({
      success: false,
      error: 'This item is no longer available to book',
    });

    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(bob);
    // Bob's booking is whole: his reservation, holding its own copy of the image.
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([bob]);
    expect(isSnapshot(reservations[0].itemImage)).toBe(true);
    // Alice's refused booking copied nothing, and nothing was freed.
    expect(copy).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  // regression: an owner's draft or complete landing between the booking's read
  // and its write was overwritten: the item came out booked, which the
  // booking-blind owner sees as available.
  it.each(['draft', 'completed'] as const)(
    'regression: an owner moving the item to %s while a booking is in flight keeps it there, and the booking gets a 409',
    async (status) => {
      const race = whileItemWriteHeld(() => patchAs(owner, { status }));
      const booking = await patchAs(alice, { status: 'booked' });

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(booking.status).toBe(409);
      expect((await booking.json()).error).toBe('This item is no longer available to book');

      const item = await Item.findById(itemId);
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      // Nothing was booked, so nothing was reserved, copied or freed.
      expect(await Reservation.countDocuments()).toBe(0);
      expect(copy).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    }
  );

  // regression: an owner's complete (or draft) landing between the unbook's
  // check and its write was undone: the item quietly went back to available and
  // bookable, and the gifter's Reservation, which the owner's change keeps, was
  // deleted with its snapshot.
  it.each(['completed', 'draft'] as const)(
    'regression: an owner moving a booked item to %s while its booker unbooks keeps it there, and the unbook gets a 409',
    async (status) => {
      expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
      const snapshot = (await Reservation.findOne({ gifter: alice }).lean())?.itemImage;
      expect(isSnapshot(snapshot)).toBe(true);

      const race = whileItemWriteHeld(() => patchAs(owner, { status }));
      const unbook = await patchAs(alice, { status: 'available' });

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(unbook.status).toBe(409);
      expect(await unbook.json()).toEqual({
        success: false,
        error: 'This item is no longer booked by you',
      });

      const item = await Item.findById(itemId);
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      // Just as if the owner's change had come first: it unassigned the item and
      // kept the gifter's reservation and its snapshot, so they can still log the
      // gift or dismiss it from their Booked page.
      const reservations = await Reservation.find().lean();
      expect(reservations.map((r) => [r.gifter.toString(), r.itemImage])).toEqual([
        [alice, snapshot],
      ]);
      expect(del).not.toHaveBeenCalled();
    }
  );

  // The write requires only what the decision rests on, so a change to anything
  // else, like an owner's content edit, lands alongside it instead of refusing it.
  it("an owner's content edit landing during a booking doesn't stop it, and neither write is lost", async () => {
    const race = whileItemWriteHeld(() => patchAs(owner, { name: 'Green Mug', mostWanted: true }));
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(booking.status).toBe(200);
    const item = await Item.findById(itemId);
    expect([item?.name, item?.mostWanted, item?.status]).toEqual(['Green Mug', true, 'booked']);
    expect(item?.bookedBy?.toString()).toBe(alice);
    // The reservation snapshots the item as the booking left it.
    const reservation = await Reservation.findOne({ gifter: alice }).lean();
    expect(reservation?.itemName).toBe('Green Mug');
    expect(isSnapshot(reservation?.itemImage)).toBe(true);
  });

  it("an owner's content edit landing during an unbook doesn't stop it, and neither write is lost", async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
    const snapshot = (await Reservation.findOne({ gifter: alice }).lean())?.itemImage;

    const race = whileItemWriteHeld(() => patchAs(owner, { name: 'Green Mug', mostWanted: true }));
    const unbook = await patchAs(alice, { status: 'available' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(unbook.status).toBe(200);
    const item = await Item.findById(itemId);
    expect([item?.name, item?.mostWanted, item?.status]).toEqual(['Green Mug', true, 'available']);
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[snapshot]]);
  });

  it('a booking that lands after the item was deleted gets a 404 and reserves nothing', async () => {
    const race = whileItemWriteHeld(async () => {
      await Item.deleteOne({ _id: itemId });
    });
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    expect(booking.status).toBe(404);
    expect((await booking.json()).error).toBe('Item not found');
    expect(await Reservation.countDocuments()).toBe(0);
    expect(copy).not.toHaveBeenCalled();
  });

  it('an unbook that lands after the item was deleted gets a 404 and keeps the reservation', async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
    const race = whileItemWriteHeld(async () => {
      await Item.deleteOne({ _id: itemId });
    });
    const unbook = await patchAs(alice, { status: 'available' });

    expect(race.held()).toBe(true);
    expect(unbook.status).toBe(404);
    // A reservation outlives its item, so the gifter can still log the gift.
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });
});

// The checks against the route's first read answer as they always have. Only a
// request that passed them and then lost a race gets the 409.
describe('PATCH /api/items/[id] — a book or unbook already refused on the first read', () => {
  it('booking an item someone else has booked is a 400, and leaves their booking alone', async () => {
    expect((await patchAs(bob, { status: 'booked' })).status).toBe(200);

    const res = await patchAs(alice, { status: 'booked' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid status transition');
    expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(bob);
    expect((await Reservation.find().lean()).map((r) => r.gifter.toString())).toEqual([bob]);
  });

  it("unbooking someone else's booking is a 403, and leaves it alone", async () => {
    expect((await patchAs(bob, { status: 'booked' })).status).toBe(200);

    const res = await patchAs(alice, { status: 'available' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('You can only unbook items you have booked');
    expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(bob);
    expect(await Reservation.countDocuments({ gifter: bob })).toBe(1);
  });

  it('unbooking an item that is no longer booked is a 400, and keeps the reservation', async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
    expect((await patchAs(owner, { status: 'completed' })).status).toBe(200);

    const res = await patchAs(alice, { status: 'available' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid status transition');
    expect((await Item.findById(itemId))?.status).toBe('completed');
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(1);
  });
});
