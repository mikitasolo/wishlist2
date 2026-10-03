import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// A member's booking decides that the caller is a plain member from reads at the
// top of the request, and its writes land later. Each race below changes the
// caller's role in that window (removed, leaving, promoted, the list archived or
// deleted) and checks that no item is left booked by someone who can't release
// it, and that an owner holds no booking or Reservation on their own list.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records copies and deletions instead of performing them, so a
// test can tell which snapshots were made and which were freed.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import { DELETE as kickRoute } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as leaveRoute } from '@/app/api/wishlists/[id]/members/me/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import {
  PATCH as patchWishlist,
  DELETE as deleteWishlistRoute,
} from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const isSnapshot = (url: unknown) =>
  typeof url === 'string' && url.startsWith(`${HOST}/snapshots/`);
const freedSnapshots = () => del.mock.calls.map(([url]) => url).filter(isSnapshot);

let owner: string;
let alice: string;
let bob: string;
let wishlistId: string;
let membershipId: string;
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
  wishlistId = wl._id.toString();
  const [aliceMembership] = await WishlistMember.create([
    { wishlist: wl._id, user: a._id },
    { wishlist: wl._id, user: b._id },
  ]);
  membershipId = aliceMembership._id.toString();
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

// `auth()` is the first thing each handler calls, synchronously on invocation, so
// a one-shot session is consumed by that call even while another is in flight.
function as(user: string) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function patchItemAs(user: string, status: 'booked' | 'available' | 'completed') {
  as(user);
  return patchItem(json(`/api/items/${itemId}`, 'PATCH', { status }), {
    params: Promise.resolve({ id: itemId }),
  });
}
const book = (user = alice) => patchItemAs(user, 'booked');

function kickAlice() {
  as(owner);
  return kickRoute(json(`/api/wishlists/${wishlistId}/members/${membershipId}`, 'DELETE'), {
    params: Promise.resolve({ id: wishlistId, memberId: membershipId }),
  });
}

function aliceLeaves() {
  as(alice);
  return leaveRoute(json(`/api/wishlists/${wishlistId}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: wishlistId }),
  });
}

/** Alice accepts an owner promotion, issued to her as a member. */
async function aliceAcceptsPromotion() {
  const invite = await WishlistInvite.create({
    wishlist: wishlistId,
    invitedBy: owner,
    invitedUser: alice,
    role: 'owner',
    promotion: true,
  });
  const inviteId = invite._id.toString();
  as(alice);
  return respondInvite(json(`/api/invites/${inviteId}`, 'PATCH', { action: 'accept' }), {
    params: Promise.resolve({ inviteId }),
  });
}

function archiveList() {
  as(owner);
  return patchWishlist(json(`/api/wishlists/${wishlistId}`, 'PATCH', { archived: true }), {
    params: Promise.resolve({ id: wishlistId }),
  });
}

function deleteList() {
  as(owner);
  return deleteWishlistRoute(json(`/api/wishlists/${wishlistId}`, 'DELETE'), {
    params: Promise.resolve({ id: wishlistId }),
  });
}

/**
 * Hold the booking's item write (after all its reads and checks) while `meanwhile`
 * runs to completion, then let it land. With `after`, the write lands first, and
 * `meanwhile` runs before the booking goes on to its Reservation.
 */
const whileBookingWriteHeld = <T>(meanwhile: () => Promise<T>, opts?: { after?: boolean }) =>
  holdFirstCall(Item, 'findOneAndUpdate', meanwhile, opts);

async function expectItemFree() {
  const item = await Item.findById(itemId);
  expect(item?.status).toBe('available');
  expect(item?.bookedBy).toBeNull();
}

describe('PATCH /api/items/[id] — a booking whose member is removed or leaves meanwhile', () => {
  const removals = [
    ['is removed', kickAlice],
    ['leaves', aliceLeaves],
  ] as const;

  // regression: the route read Alice as a member at the top of the request and
  // never again, so a booking that landed after her removal (or leave) had
  // released her bookings and deleted her membership left the item booked by a
  // non-member: a 403 on the item for her, booked to every other member, and
  // invisible to the booking-blind owners. Nobody could release it.
  it.each(removals)(
    'regression: a booking that lands after its member %s is undone, with a 403',
    async (_, removal) => {
      const race = whileBookingWriteHeld(removal);
      const booking = await book();

      expect(race.held()).toBe(true);
      expect((race.outcome() as Response).status).toBe(200);
      expect(booking.status).toBe(403);
      expect(await booking.json()).toEqual({
        success: false,
        error: 'Unauthorized - No access to this wishlist',
      });
      await expectItemFree();
      // The booking failed, so it leaves no reservation, and copied no image.
      expect(await Reservation.countDocuments()).toBe(0);
      expect(copy).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    }
  );

  // regression: as above, with the item write landing just before the removal,
  // so the removal frees the item and the booking then writes its Reservation for
  // an item it no longer holds.
  it.each(removals)(
    'regression: a booking whose item write lands just before its member %s is undone too',
    async (_, removal) => {
      const race = whileBookingWriteHeld(removal, { after: true });
      const booking = await book();

      expect(race.held()).toBe(true);
      expect((race.outcome() as Response).status).toBe(200);
      expect(booking.status).toBe(403);
      await expectItemFree();
      expect(await Reservation.countDocuments()).toBe(0);
    }
  );

  // regression: a booking that landed between the removal's release and its
  // membership delete re-checked the membership before that delete, so it stood,
  // and then the delete left it held by a non-member. The removal now frees the
  // member's items once more after the delete.
  it.each(removals)(
    'regression: a booking that completes while its member %s is released after the membership delete',
    async (_, removal) => {
      const race = holdFirstCall(WishlistMember, 'deleteOne', () => book());
      const removed = await removal();

      expect(race.held()).toBe(true);
      expect(removed.status).toBe(200);
      // The booking checked in before the membership went, so it stood ...
      expect((race.outcome() as Response).status).toBe(200);
      // ... and the removal freed it afterwards, keeping the reservation, as for
      // any booking made before a leave or kick.
      await expectItemFree();
      const reservations = await Reservation.find().lean();
      expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
      expect(isSnapshot(reservations[0].itemImage)).toBe(true);
      expect(del).not.toHaveBeenCalled();
    }
  );

  // Leaving reports the bookings it freed to the gifter themselves, the late one too.
  it('a leave counts the booking it freed after the membership delete', async () => {
    holdFirstCall(WishlistMember, 'deleteOne', () => book());
    const res = await aliceLeaves();
    expect((await res.json()).data.unbookedItemsCount).toBe(1);
  });

  // The kick has landed by the time of the second release, so a failure there
  // mustn't turn it into an error or skip telling the member they were removed.
  it('a kick whose second release fails still answers 200 and notifies, logging no user id', async () => {
    const realUpdateMany = Item.updateMany.bind(Item);
    let calls = 0;
    vi.spyOn(Item, 'updateMany').mockImplementation(((
      ...args: Parameters<typeof Item.updateMany>
    ) =>
      ++calls === 2 ? Promise.reject(new Error('db blip')) : realUpdateMany(...args)) as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await kickAlice();

    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(await WishlistMember.exists({ wishlist: wishlistId, user: alice })).toBeNull();
    expect(await Notification.countDocuments({ user: alice, type: 'removed_from_wishlist' })).toBe(
      1
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(alice);
  });

  // The undo is conditional on the booking still being the caller's, so it
  // can't free an item another member booked after the removal freed it.
  it("undoing a removed member's booking leaves another member's later booking alone", async () => {
    const race = whileBookingWriteHeld(
      async () => {
        await kickAlice();
        return book(bob);
      },
      { after: true }
    );
    const booking = await book();

    expect((race.outcome() as Response).status).toBe(200);
    expect(booking.status).toBe(403);
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(bob);
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([bob]);
  });

  /** Alice books, and the owner completes and reopens the item, renaming it. */
  async function keptReservation() {
    expect((await book()).status).toBe(200);
    expect((await patchItemAs(owner, 'completed')).status).toBe(200);
    as(owner);
    const reopened = await patchItem(
      json(`/api/items/${itemId}`, 'PATCH', { status: 'available', name: 'Red Mug' }),
      { params: Promise.resolve({ id: itemId }) }
    );
    expect(reopened.status).toBe(200);
    const reservation = await Reservation.findOne({ gifter: alice }).lean();
    expect(reservation?.itemName).toBe('Blue Mug');
    expect(isSnapshot(reservation?.itemImage)).toBe(true);
    del.mockClear();
    copy.mockClear();
    return reservation!;
  }

  // Rebooking an item over a reservation that an owner's status change kept: the
  // removal would have left that reservation as it was had it come first, so the
  // undo puts it back, snapshot and all.
  it('a rebooking undone by a removal puts back the reservation it overwrote', async () => {
    const earlier = await keptReservation();

    whileBookingWriteHeld(kickAlice);
    const rebooking = await book();

    expect(rebooking.status).toBe(403);
    await expectItemFree();
    const reservations = await Reservation.find().lean();
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      _id: earlier._id,
      itemName: 'Blue Mug',
      itemImage: earlier.itemImage,
    });
    expect(copy).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  // Nothing holds the overwritten snapshot once the reservation has gone, so the
  // undo frees it instead of leaking it.
  it('a rebooking undone after its reservation was dismissed meanwhile frees the snapshot it overwrote', async () => {
    const earlier = await keptReservation();

    // Held at the re-check, after both of the booking's writes.
    holdFirstCall(WishlistMember, 'exists', async () => {
      expect((await kickAlice()).status).toBe(200);
      await deleteReservations({ gifter: alice });
    });
    const rebooking = await book();

    expect(rebooking.status).toBe(403);
    await expectItemFree();
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[earlier.itemImage]]);
  });
});

describe('PATCH /api/items/[id] — a booking whose member becomes an owner meanwhile', () => {
  // regression: accepting a promotion releases the new owner's bookings and
  // reservations, and a booking that landed after that left an owner holding a
  // booking, and a Reservation, on their own list, which they could never see or
  // cancel again.
  it('regression: a booking that lands after its member accepts a promotion is undone', async () => {
    const race = whileBookingWriteHeld(aliceAcceptsPromotion);
    const booking = await book();

    expect(race.held()).toBe(true);
    expect((race.outcome() as Response).status).toBe(200);
    expect(isWishlistOwner((await Wishlist.findById(wishlistId))!, alice)).toBe(true);
    // Answered as an owner's attempt to book is.
    expect(booking.status).toBe(400);
    expect((await booking.json()).error).toBe(
      'Owners can only publish an item, move it to draft or mark it as received'
    );
    await expectItemFree();
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
    expect(copy).not.toHaveBeenCalled();
  });

  // regression: the item write landing just before the promotion is freed by the
  // promotion's release, but the booking then wrote its Reservation, which the
  // new owner was left holding.
  it('regression: a booking whose item write lands just before its member accepts a promotion leaves no reservation', async () => {
    const race = whileBookingWriteHeld(aliceAcceptsPromotion, { after: true });
    const booking = await book();

    expect(race.held()).toBe(true);
    expect((race.outcome() as Response).status).toBe(200);
    expect(booking.status).toBe(400);
    await expectItemFree();
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
  });

  // A booking that's done before the promotion takes the membership stands, and
  // the promotion's release then frees it, as for any booking a new owner held.
  it('a booking that completes before the promotion takes the membership is released by it', async () => {
    const race = holdFirstCall(WishlistMember, 'findOneAndDelete', () => book());
    const accept = await aliceAcceptsPromotion();

    expect(race.held()).toBe(true);
    expect((race.outcome() as Response).status).toBe(200);
    expect(accept.status).toBe(200);
    await expectItemFree();
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
  });

  // An owner holds no reservation on their own list, even one that predates the
  // booking (`releaseGifterHoldings` would have deleted it had it come first).
  it('a rebooking undone by a promotion leaves no reservation, not even the earlier one', async () => {
    expect((await book()).status).toBe(200);
    expect((await patchItemAs(owner, 'completed')).status).toBe(200);
    expect((await patchItemAs(owner, 'available')).status).toBe(200);
    const earlier = (await Reservation.findOne({ gifter: alice }).lean())?.itemImage;
    expect(isSnapshot(earlier)).toBe(true);

    whileBookingWriteHeld(aliceAcceptsPromotion);
    const rebooking = await book();

    expect(rebooking.status).toBe(400);
    await expectItemFree();
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
    expect(del.mock.calls).toEqual([[earlier]]);
  });
});

describe('PATCH /api/items/[id] — a booking on a list archived or deleted meanwhile', () => {
  // regression: a booking that landed after an owner archived the list booked an
  // item the member could no longer see (404), so they couldn't release it until
  // the list was unarchived.
  it.each([
    ['before', false],
    ['after', true],
  ] as const)(
    'regression: a booking whose item write lands %s the list is archived is undone, with a 404',
    async (_, after) => {
      const race = whileBookingWriteHeld(archiveList, { after });
      const booking = await book();

      expect(race.held()).toBe(true);
      expect((race.outcome() as Response).status).toBe(200);
      expect(booking.status).toBe(404);
      expect((await booking.json()).error).toBe('Item not found');
      await expectItemFree();
      expect(await Reservation.countDocuments()).toBe(0);
      expect(copy).not.toHaveBeenCalled();
    }
  );

  // The item goes with the list, so nothing is stranded, and deleting a list
  // keeps the reservations on purpose, so the gifter can still log the gift.
  it('a booking whose item write lands just before the list is deleted stands, and keeps its reservation', async () => {
    const race = whileBookingWriteHeld(deleteList, { after: true });
    const booking = await book();

    expect(race.held()).toBe(true);
    expect((race.outcome() as Response).status).toBe(200);
    expect(booking.status).toBe(200);
    expect(await Item.exists({ _id: itemId })).toBeNull();
    const reservations = await Reservation.find().lean();
    expect(reservations.map((r) => r.gifter.toString())).toEqual([alice]);
    expect(isSnapshot(reservations[0].itemImage)).toBe(true);
    expect(freedSnapshots()).toEqual([]);
  });

  // An archive that lands once the booking is done changes nothing: a booking
  // made before archiving stands, as it always has.
  it('a booking that completes before the list is archived stands', async () => {
    expect((await book()).status).toBe(200);
    expect((await archiveList()).status).toBe(200);
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(alice);
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(1);
  });
});
