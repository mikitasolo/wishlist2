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
import GiftLog from '@/models/GiftLog';
import { addWishlistOwner } from '@/lib/utils/wishlistOwnership';
import { bookingWasReleased } from '@/lib/utils/bookingReservations';
import { Types } from 'mongoose';

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
      error: 'This item is no longer available to reserve',
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
      expect((await booking.json()).error).toBe('This item is no longer available to reserve');

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
        error: 'This item is no longer reserved by you',
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

describe("PATCH /api/items/[id] — an owner's publish or reopen racing a booking", () => {
  // regression (WIS-108): the owner's `available` was decided on a stale view
  // (the item read as a draft or received) and written unconditionally, so it
  // released a booking made since, while its gifter kept the Reservation: the
  // item was bookable again, and a second member could book it too.
  it.each(['draft', 'completed'])(
    'regression: a publish or reopen of a %s item that lands after a co-owner published it and a member booked it keeps the booking',
    async (from) => {
      await Item.updateOne({ _id: itemId }, { status: from });
      const race = whileItemWriteHeld(async () => {
        await Item.updateOne({ _id: itemId }, { status: 'available' }); // a co-owner's publish
        return patchAs(alice, { status: 'booked' });
      });
      const publish = await patchAs(owner, { status: 'available' });

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(publish.status).toBe(200);
      // Answered as on an unbooked item: an owner never learns of the booking.
      const { data } = await publish.json();
      expect([data.status, data.bookedBy]).toEqual(['available', undefined]);

      const item = await Item.findById(itemId);
      expect(item?.status).toBe('booked');
      expect(item?.bookedBy?.toString()).toBe(alice);
      expect(await Reservation.countDocuments({ gifter: alice, item: itemId })).toBe(1);
      // Nobody else can book it now.
      expect((await patchAs(bob, { status: 'booked' })).status).toBe(400);
      expect(await Reservation.countDocuments({ gifter: bob })).toBe(0);
    }
  );

  it('a move to draft or mark as received landing after a booking still releases it and keeps the Reservation', async () => {
    for (const status of ['draft', 'completed']) {
      await Item.updateOne({ _id: itemId }, { status: 'available', bookedBy: null });
      await Reservation.deleteMany({});
      const race = whileItemWriteHeld(() => patchAs(alice, { status: 'booked' }));
      const change = await patchAs(owner, { status });
      race.restore();

      expect(race.outcome()?.status).toBe(200);
      expect(change.status).toBe(200);
      const item = await Item.findById(itemId);
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      expect(await Reservation.countDocuments({ gifter: alice, item: itemId })).toBe(1);
    }
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
    expect((await res.json()).error).toBe('You can only release items you have reserved');
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

// A book or unbook writes the item, then the Reservation, in two steps. The
// same person booking and unbooking one item from two tabs can land the other
// request in between, so each side re-checks the item once its Reservation
// write is done, and leaves the Reservation the way the later item write would
// have. What keeps one on purpose (an owner's status change, the item's
// deletion) still keeps it.
describe('PATCH /api/items/[id] — a Reservation write landing after the item has moved on', () => {
  /** Hold the booking's Reservation write while `meanwhile` runs to completion. */
  const whileReservationWriteHeld = <T>(meanwhile: () => Promise<T>) =>
    holdFirstCall(Reservation, 'findOneAndUpdate', meanwhile);
  /** Hold the unbook's Reservation delete while `meanwhile` runs to completion. */
  const whileReservationDeleteHeld = <T>(meanwhile: () => Promise<T>) =>
    holdFirstCall(Reservation, 'findOneAndDelete', meanwhile);

  /** The snapshot URLs every copy so far made. */
  const copies = () => copy.mock.calls.map(([, to]) => `${HOST}/${to}`);

  // regression: the book's Reservation write landed after the same person's
  // unbook had freed the item and deleted (nothing), so they held a Reservation
  // for an available item, and someone else booking it left two people holding
  // one item.
  it('regression: a booking whose Reservation write lands after its own unbook leaves no Reservation behind', async () => {
    const race = whileReservationWriteHeld(() => patchAs(alice, { status: 'available' }));
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    // Both writes on the item landed, the booking first.
    expect(booking.status).toBe(200);
    expect(race.outcome()?.status).toBe(200);

    const item = await Item.findById(itemId);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.countDocuments()).toBe(0);
    // Taken back before its image was copied, and the item's own upload, which
    // the Reservation pointed at meanwhile, is left alone.
    expect(copy).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  // regression: the unbook's Reservation delete landed after the same person had
  // booked the item again, and took that booking's Reservation, so the item was
  // booked by them but missing from their Booked page.
  it('regression: an unbook whose Reservation delete lands after its own rebooking writes the Reservation again', async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);

    const race = whileReservationDeleteHeld(() => patchAs(alice, { status: 'booked' }));
    const unbook = await patchAs(alice, { status: 'available' });

    expect(race.held()).toBe(true);
    // Both writes on the item landed, the unbook first.
    expect(unbook.status).toBe(200);
    expect(race.outcome()?.status).toBe(200);

    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(alice);
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
    // With its own snapshot, and every other copy freed exactly once: none leaked
    // and none the Reservation shows was freed.
    const image = reservations[0].itemImage;
    expect(isSnapshot(image)).toBe(true);
    expect(del.mock.calls.flat().sort()).toEqual(
      copies()
        .filter((url) => url !== image)
        .sort()
    );
  });

  it('a booking whose Reservation write lands after its own unbook and then someone else booking it leaves only theirs', async () => {
    const race = whileReservationWriteHeld(async () => [
      (await patchAs(alice, { status: 'available' })).status,
      (await patchAs(bob, { status: 'booked' })).status,
    ]);
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    expect(booking.status).toBe(200);
    expect(race.outcome()).toEqual([200, 200]);

    expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(bob);
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([bob]);
    expect(isSnapshot(reservations[0].itemImage)).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it("an unbook whose Reservation delete lands after someone else booked the item doesn't write one back", async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
    const alicesSnapshot = (await Reservation.findOne({ gifter: alice }).lean())?.itemImage;

    const race = whileReservationDeleteHeld(() => patchAs(bob, { status: 'booked' }));
    const unbook = await patchAs(alice, { status: 'available' });

    expect(race.held()).toBe(true);
    expect(unbook.status).toBe(200);
    expect(race.outcome()?.status).toBe(200);

    expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(bob);
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([bob]);
    expect(del.mock.calls).toEqual([[alicesSnapshot]]);
  });

  // WIS-81: an owner's status change unassigns the item but keeps the gifter's
  // Reservation, so they can still log the gift. One landing between the
  // booking's two writes has to end the same way.
  it.each(['completed', 'draft'] as const)(
    "an owner moving the item to %s before the booking's Reservation write lands keeps the Reservation",
    async (status) => {
      const race = whileReservationWriteHeld(() => patchAs(owner, { status }));
      const booking = await patchAs(alice, { status: 'booked' });

      expect(race.held()).toBe(true);
      expect(booking.status).toBe(200);
      expect(race.outcome()?.status).toBe(200);

      const item = await Item.findById(itemId);
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      const reservations = await Reservation.find().lean();
      expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
      expect(isSnapshot(reservations[0].itemImage)).toBe(true);
      expect(del).not.toHaveBeenCalled();
    }
  );

  it("the item being deleted before the booking's Reservation write lands keeps the Reservation", async () => {
    const race = whileReservationWriteHeld(async () => {
      await Item.deleteOne({ _id: itemId });
    });
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    expect(booking.status).toBe(200);
    // A Reservation outlives its item, so the gifter can still log the gift.
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
    expect(isSnapshot(reservations[0].itemImage)).toBe(true);
  });

  // Becoming an owner frees the item and cancels the Reservation: an owner can't
  // be their own gifter. One written after that cancel would survive it.
  it("becoming an owner before the booking's Reservation write lands leaves no Reservation behind", async () => {
    const race = whileReservationWriteHeld(async () =>
      addWishlistOwner((await Wishlist.findOne().lean())!, alice)
    );
    const booking = await patchAs(alice, { status: 'booked' });

    expect(race.held()).toBe(true);
    // Which answer it gets is a role re-check's to decide; either way it didn't fail.
    expect(booking.status).toBeLessThan(500);
    expect(race.outcome()).toEqual({ unbookedItems: 1, cancelledReservations: 0 });

    const item = await Item.findById(itemId);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.countDocuments()).toBe(0);
    expect(copy).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("an unbook whose rebooking's Reservation is written after the unbook's delete leaves that one as it is", async () => {
    expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
    const first = (await Reservation.findOne({ gifter: alice }).lean())?.itemImage;

    // Freeing the deleted Reservation's snapshot checks the gift log, after the
    // delete and before the unbook re-reads the item: hold it there while the
    // rebooking lands in full.
    const race = holdFirstCall(GiftLog, 'exists', () => patchAs(alice, { status: 'booked' }));
    const unbook = await patchAs(alice, { status: 'available' });

    expect(race.held()).toBe(true);
    expect(unbook.status).toBe(200);
    expect(race.outcome()?.status).toBe(200);

    expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(alice);
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
    // The rebooking's own snapshot, not replaced by a second copy: the unbook
    // only freed the one its delete took.
    const second = reservations[0].itemImage;
    expect(isSnapshot(second)).toBe(true);
    expect(copies()).toEqual([first, second]);
    expect(del.mock.calls).toEqual([[first]]);
  });

  describe('a re-check that fails', () => {
    /** Make the request's second `Item.findById` (its re-check's) throw. */
    function failTheReCheck() {
      const real = Item.findById.bind(Item);
      let calls = 0;
      vi.spyOn(Item, 'findById').mockImplementation(((...args: Parameters<typeof real>) => {
        calls += 1;
        if (calls === 2) throw new Error('connection reset');
        return real(...args);
      }) as typeof Item.findById);
      return vi.spyOn(console, 'error').mockImplementation(() => {});
    }

    it('is logged, without personal data, and the booking stands with its Reservation', async () => {
      const errorLog = failTheReCheck();
      const booking = await patchAs(alice, { status: 'booked' });

      expect(booking.status).toBe(200);
      expect(errorLog.mock.calls).toEqual([
        ['Re-checking a booking against its item failed:', { name: 'Error', code: undefined }],
      ]);
      vi.mocked(Item.findById).mockRestore();
      expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(alice);
      const reservation = await Reservation.findOne({ gifter: alice }).lean();
      expect(isSnapshot(reservation?.itemImage)).toBe(true);
    });

    it('is logged, and the unbook stands without a Reservation', async () => {
      expect((await patchAs(alice, { status: 'booked' })).status).toBe(200);
      const errorLog = failTheReCheck();
      const unbook = await patchAs(alice, { status: 'available' });

      expect(unbook.status).toBe(200);
      expect(errorLog.mock.calls).toEqual([
        ['Re-checking an unbook against its item failed:', { name: 'Error', code: undefined }],
      ]);
      vi.mocked(Item.findById).mockRestore();
      expect((await Item.findById(itemId))?.status).toBe('available');
      expect(await Reservation.countDocuments()).toBe(0);
    });
  });
});

// Who the gifter now is decides whether a booking that's no longer theirs was
// released by them (its fresh Reservation goes) or by something that keeps the
// Reservation on purpose. Checked on the states themselves, whatever race led
// there.
describe('bookingWasReleased', () => {
  type ItemState = 'deleted' | { status: string; bookedBy?: 'alice' | 'bob' };
  type Role = 'member' | 'owner' | 'off the list';

  /** Put Alice's booked item and her place on the list in a state, then ask. */
  async function releasedFrom(item: ItemState, role: Role, { listDeleted = false } = {}) {
    const wishlist = (await Wishlist.findOne().lean())!;
    if (role !== 'member') await WishlistMember.deleteOne({ user: alice });
    if (role === 'owner') await Wishlist.updateOne({}, { $addToSet: { owners: alice } });
    if (item === 'deleted') {
      await Item.deleteOne({ _id: itemId });
    } else {
      const bookedBy = item.bookedBy && { alice, bob }[item.bookedBy];
      await Item.updateOne({ _id: itemId }, { $set: { status: item.status, bookedBy } });
    }
    if (listDeleted) await Wishlist.deleteOne({});
    return bookingWasReleased(alice, wishlist._id, new Types.ObjectId(itemId));
  }

  it.each<[string, ItemState, Role, boolean]>([
    ['still booked by them: kept', { status: 'booked', bookedBy: 'alice' }, 'member', false],
    ['available, by their own unbook: released', { status: 'available' }, 'member', true],
    [
      'booked by someone else since: released',
      { status: 'booked', bookedBy: 'bob' },
      'member',
      true,
    ],
    ['available, as they became an owner: released', { status: 'available' }, 'owner', true],
    [
      'available, as they left or were removed: kept',
      { status: 'available' },
      'off the list',
      false,
    ],
    [
      'booked by someone else after they left: kept',
      { status: 'booked', bookedBy: 'bob' },
      'off the list',
      false,
    ],
    ['completed by an owner: kept', { status: 'completed' }, 'member', false],
    ['moved to draft by an owner: kept', { status: 'draft' }, 'member', false],
    ['deleted: kept', 'deleted', 'member', false],
  ])('the item %s', async (_case, item, role, released) => {
    expect(await releasedFrom(item, role)).toBe(released);
  });

  it('the list being deleted: kept, as its delete keeps it', async () => {
    expect(await releasedFrom({ status: 'available' }, 'member', { listDeleted: true })).toBe(
      false
    );
  });
});
