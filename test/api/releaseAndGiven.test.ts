import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { GET as LIST_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { GET as LIST_RESERVATIONS } from '@/app/api/users/me/reservations/route';
import { POST as GIFT } from '@/app/api/reservations/[id]/gift/route';
import { DELETE as DISMISS } from '@/app/api/reservations/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

/**
 * The gifter's side of a booking, from the Reserved page and the list:
 *
 *  - Release on the Reserved page is the list's own unbook
 *    (`PATCH /api/items/[itemId]`, the item id from the reservations read), so
 *    the item is freed and the Reservation settled exactly as an unbook from
 *    the list does. Dismiss (`DELETE /api/reservations/[id]`) stays for a
 *    reservation detached from its item, and only ever ends that Reservation.
 *  - A member's own read of the list flags a gift they hold the booking of and
 *    have marked as given (`givenByMe`), from their own gift history. Nothing
 *    of it reaches an owner, a visitor, or anyone else's bookings.
 */

const session = vi.mocked(auth);

let owner: string;
let coOwner: string;
let gifter: string;
let otherMember: string;
let wishlistId: string;

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
  otherMember = await user('other');
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [owner, coOwner],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create([
    { wishlist: wl._id, user: gifter },
    { wishlist: wl._id, user: otherMember },
  ]);
});

function signIn(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

async function makeItem(name: string) {
  const item = await Item.create({ wishlist: wishlistId, name, status: 'available' });
  return item._id.toString();
}

/** `PATCH /api/items/[id]` as `userId`: the list's book and unbook, and Release. */
async function patchItem(userId: string, itemId: string, body: Record<string, unknown>) {
  signIn(userId);
  const res = await PATCH_ITEM(
    new NextRequest(`http://localhost/api/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: itemId }) }
  );
  return { status: res.status, body: await res.json() };
}

/** A member books the item from the list, which writes their Reservation. */
async function book(userId: string, itemId: string) {
  const { status } = await patchItem(userId, itemId, { status: 'booked' });
  expect(status).toBe(200);
}

interface ReservationRow {
  _id: string;
  itemId: string;
  itemName: string;
  itemStatus: string;
  stillReserved: boolean;
}

/** The gifter's reservations, as the Reserved page reads them. */
async function reservations(userId = gifter): Promise<ReservationRow[]> {
  signIn(userId);
  const res = await LIST_RESERVATIONS();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

async function reservationFor(itemName: string) {
  const row = (await reservations()).find((r) => r.itemName === itemName);
  if (!row) throw new Error(`no reservation for ${itemName}`);
  return row;
}

/** "Mark as gifted" on the Reserved page. */
async function markGiven(reservationId: string) {
  signIn(gifter);
  const res = await GIFT(
    new NextRequest(`http://localhost/api/reservations/${reservationId}/gift`, { method: 'POST' }),
    { params: Promise.resolve({ id: reservationId }) }
  );
  expect(res.status).toBe(201);
}

async function dismiss(reservationId: string) {
  signIn(gifter);
  const res = await DISMISS(
    new NextRequest(`http://localhost/api/reservations/${reservationId}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: reservationId }) }
  );
  return res.status;
}

/** Release on the Reserved page: the list's unbook, sent to the reservation's item. */
async function release(row: ReservationRow) {
  return patchItem(gifter, row.itemId, { status: 'available' });
}

type ItemRow = { _id: string; name: string; status: string } & Record<string, unknown>;

/** The list's items, as `userId` reads them (signed out with `null`). */
async function listItems(userId: string | null): Promise<ItemRow[]> {
  signIn(userId);
  const res = await LIST_ITEMS(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`),
    {
      params: Promise.resolve({ id: wishlistId }),
    }
  );
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

const byName = (rows: ItemRow[]) => Object.fromEntries(rows.map((r) => [r.name, r]));

describe('Release from the Reserved page', () => {
  // regression: the only action on an active reservation was Dismiss, which
  // deletes the Reservation and leaves the item booked under the gifter's name:
  // nobody else could book it, and nothing tracked it for the gifter any more.
  it("regression: the list's own unbook, sent to the read's item id, frees the item and settles the Reservation", async () => {
    const lego = await makeItem('Lego set');
    const kite = await makeItem('Kite');
    await book(gifter, lego);
    await book(gifter, kite);

    const row = await reservationFor('Lego set');
    expect(row).toMatchObject({ itemId: lego, itemStatus: 'booked', stillReserved: true });

    const { status, body } = await release(row);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: 'available', givenByMe: false });

    // The item is free for the others on the list...
    const item = await Item.findById(lego).lean();
    expect(item).toMatchObject({ status: 'available', bookedBy: null });
    expect((await listItems(otherMember)).find((i) => i.name === 'Lego set')?.status).toBe(
      'available'
    );
    // ...and its Reservation ended as an unbook from the list ends it: the card
    // is gone, the other one stays, and no gift was logged.
    expect(await Reservation.exists({ gifter, item: lego })).toBeNull();
    expect((await reservations()).map((r) => r.itemName)).toEqual(['Kite']);
    expect(await GiftLog.countDocuments()).toBe(0);
  });

  it('is refused once the gifter is off the list, and leaves the Reservation for Dismiss', async () => {
    const lego = await makeItem('Lego set');
    await book(gifter, lego);
    const row = await reservationFor('Lego set');

    // They're kicked: the membership goes, and their booking is freed (the
    // Reservation is kept, so they can still log a gift they went on to give).
    await WishlistMember.deleteOne({ wishlist: wishlistId, user: gifter });
    await Item.updateOne({ _id: lego }, { status: 'available', bookedBy: null });

    const { status } = await release(row);
    expect(status).toBe(403);
    expect(await Reservation.exists({ gifter, item: lego })).not.toBeNull();
    // The read shows the card as needing their confirmation, with Dismiss.
    expect(await reservationFor('Lego set')).toMatchObject({ stillReserved: false });
  });

  it('is refused for an item someone else has booked since, which stays theirs', async () => {
    const lego = await makeItem('Lego set');
    await book(gifter, lego);
    const row = await reservationFor('Lego set');
    // The owner marked it received and reopened it, and another member booked it.
    await Item.updateOne({ _id: lego }, { status: 'booked', bookedBy: otherMember });

    const { status } = await release(row);
    expect(status).toBe(403);
    expect(await Item.findById(lego).lean()).toMatchObject({ status: 'booked' });
    expect((await Item.findById(lego).lean())?.bookedBy?.toString()).toBe(otherMember);
    expect(await Reservation.exists({ gifter, item: lego })).not.toBeNull();
    expect(await reservationFor('Lego set')).toMatchObject({ stillReserved: false });
  });

  // An archived list is owner-only, so the item route answers its unbook with a
  // 404. A card offering only a Release that can't work would leave the gifter
  // stuck with it, so it's no longer active: it needs their confirmation, and
  // Dismiss clears it.
  it('a reservation on an archived list is no longer active, so its card offers Dismiss', async () => {
    const lego = await makeItem('Lego set');
    await book(gifter, lego);
    await Wishlist.updateOne({ _id: wishlistId }, { archived: true });

    const row = await reservationFor('Lego set');
    expect(row).toMatchObject({ itemStatus: 'booked', stillReserved: false });
    expect((await release(row)).status).toBe(404);
    expect(await Item.findById(lego).lean()).toMatchObject({ status: 'booked' });

    // Unarchived, it's active again.
    await Wishlist.updateOne({ _id: wishlistId }, { archived: false });
    expect(await reservationFor('Lego set')).toMatchObject({ stillReserved: true });
  });
});

describe('Dismiss on a reservation detached from its item', () => {
  // regression: Dismiss is for a card that needs confirmation, and only ever
  // ends that one Reservation: it never touches the item, the gifter's other
  // reservations, anyone else's, or the gift history.
  it('regression: deletes only that Reservation', async () => {
    const lego = await makeItem('Lego set');
    const kite = await makeItem('Kite');
    const vase = await makeItem('Vase');
    await book(gifter, lego);
    await book(gifter, kite);
    await book(otherMember, vase);
    await markGiven((await reservationFor('Kite'))._id);

    // The owner marks the Lego set received: the gifter's card needs confirmation.
    expect((await patchItem(owner, lego, { status: 'completed' })).status).toBe(200);
    const row = await reservationFor('Lego set');
    expect(row).toMatchObject({ itemStatus: 'completed', stillReserved: false });

    expect(await dismiss(row._id)).toBe(200);

    expect(await Reservation.exists({ _id: row._id })).toBeNull();
    // The item is as the owner left it.
    expect(await Item.findById(lego).lean()).toMatchObject({ status: 'completed', bookedBy: null });
    // Everything else is untouched.
    expect(await Reservation.exists({ gifter: otherMember, item: vase })).not.toBeNull();
    expect(await GiftLog.countDocuments({ gifter })).toBe(1);
    expect(await Item.findById(kite).lean()).toMatchObject({ status: 'booked' });
  });
});

describe('"Given by you" on the items read (givenByMe)', () => {
  /** The gifter books `name`, and marks it as given from the Reserved page. */
  async function bookAndGive(name: string) {
    const id = await makeItem(name);
    await book(gifter, id);
    await markGiven((await reservationFor(name))._id);
    return id;
  }

  // regression: after "Mark as gifted" the list still offered the gifter
  // Unbook, and pressing it put a gift already given back up for someone else
  // to buy. The gifter's read now says which of their bookings they've given.
  it("regression: flags the gifter's own given booking, and nothing else", async () => {
    await bookAndGive('Lego set');
    await book(gifter, await makeItem('Kite'));
    await book(otherMember, await makeItem('Vase'));
    await makeItem('Lamp');

    const items = byName(await listItems(gifter));
    expect(items['Lego set']).toMatchObject({
      status: 'booked',
      bookedBy: gifter,
      givenByMe: true,
    });
    // Booked by them, not given yet.
    expect(items['Kite']).toMatchObject({ status: 'booked', bookedBy: gifter, givenByMe: false });
    // Someone else's booking, and a free item.
    expect(items['Vase']).toMatchObject({ status: 'booked', givenByMe: false });
    expect(items['Lamp']).toMatchObject({ status: 'available', givenByMe: false });
  });

  it("is only ever the viewer's own: another member's gift history never flags it for them", async () => {
    // The other member gave the Lego set once, released it, and the gifter booked it since.
    const lego = await makeItem('Lego set');
    await book(otherMember, lego);
    const theirs = (await reservations(otherMember))[0];
    signIn(otherMember);
    await GIFT(
      new NextRequest(`http://localhost/api/reservations/${theirs._id}/gift`, { method: 'POST' }),
      { params: Promise.resolve({ id: theirs._id }) }
    );
    expect((await patchItem(otherMember, lego, { status: 'available' })).status).toBe(200);
    await book(gifter, lego);

    // The gifter hasn't given it, whatever the other member's history says...
    expect(byName(await listItems(gifter))['Lego set']).toMatchObject({
      bookedBy: gifter,
      givenByMe: false,
    });
    // ...and to the other member it's someone else's booking.
    expect(byName(await listItems(otherMember))['Lego set']).toMatchObject({
      status: 'booked',
      givenByMe: false,
    });
    expect(byName(await listItems(otherMember))['Lego set'].bookedBy).toBeUndefined();
  });

  // Owners are booking-blind: the flag is neither computed for them nor in
  // their answer, even for an owner whose own gift history has the item (a
  // member who gave it, and was made an owner since).
  it('regression guard: never reaches an owner, a visitor, or a signed-out reader', async () => {
    const lego = await bookAndGive('Lego set');
    await GiftLog.create({
      gifter: coOwner,
      giftedAt: new Date(),
      itemName: 'Lego set',
      recipient: owner,
      wishlistName: 'Birthday',
      wishlist: wishlistId,
      item: lego,
    });
    const visitor = await user('visitor');

    for (const reader of [owner, coOwner, visitor, null]) {
      const items = await listItems(reader);
      expect(items).toHaveLength(1);
      expect(items[0]).not.toHaveProperty('givenByMe');
      expect(items[0]).toMatchObject({ status: 'available' });
      expect(items[0]).not.toHaveProperty('bookedBy');
    }

    // Nor in an owner's answer to an edit.
    const { body } = await patchItem(owner, lego, { name: 'Lego castle' });
    expect(body.data).not.toHaveProperty('givenByMe');
    expect(body.data.status).toBe('available');
  });

  it("comes back with the member's own book and unbook, as the list read gives it", async () => {
    const lego = await bookAndGive('Lego set');

    // Released from the list (Release… on the card): freed for the others, and
    // the gift stays in their history, which is permanent.
    const released = await patchItem(gifter, lego, { status: 'available' });
    expect(released.status).toBe(200);
    expect(released.body.data).toMatchObject({ status: 'available', givenByMe: false });
    expect(await GiftLog.countDocuments({ gifter, item: lego })).toBe(1);
    expect(byName(await listItems(gifter))['Lego set']).toMatchObject({
      status: 'available',
      givenByMe: false,
    });

    // Booked again, it's a new booking, with a Reservation of its own: not the
    // one they gave, so the card offers Unbook.
    const rebooked = await patchItem(gifter, lego, { status: 'booked' });
    expect(rebooked.status).toBe(200);
    expect(rebooked.body.data).toMatchObject({ status: 'booked', givenByMe: false });
    expect(byName(await listItems(gifter))['Lego set']).toMatchObject({ givenByMe: false });
  });

  // An earlier gift of the same item says nothing about the booking they hold
  // now. Marking a gift ends its booking's Reservation, so one they hold a
  // Reservation for is a newer booking, not given yet.
  it("doesn't flag a new booking of a wish they gave before, once the owner reopened it", async () => {
    const coffee = await bookAndGive('Coffee beans');
    // The owner marks it received, then wants it again.
    expect((await patchItem(owner, coffee, { status: 'completed' })).status).toBe(200);
    expect((await patchItem(owner, coffee, { status: 'available' })).status).toBe(200);

    const rebooked = await patchItem(gifter, coffee, { status: 'booked' });
    expect(rebooked.body.data).toMatchObject({ status: 'booked', givenByMe: false });
    expect(byName(await listItems(gifter))['Coffee beans']).toMatchObject({
      bookedBy: gifter,
      givenByMe: false,
    });

    // Given again, it's flagged again.
    await markGiven((await reservationFor('Coffee beans'))._id);
    expect(byName(await listItems(gifter))['Coffee beans']).toMatchObject({ givenByMe: true });
    expect(await GiftLog.countDocuments({ gifter, item: coffee })).toBe(2);
  });

  // The flag only labels the card, so failing to read it fails nothing: the
  // list and the booking answer as usual, and the log has no user id.
  it('is best-effort: a failed read flags nothing and logs only its kind', async () => {
    const lego = await bookAndGive('Lego set');
    const distinct = vi.spyOn(GiftLog, 'distinct').mockImplementation(() => {
      throw Object.assign(new Error(`query on gifter ${gifter} failed`), {
        name: 'MongoServerError',
        code: 6,
      });
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(byName(await listItems(gifter))['Lego set']).toMatchObject({
        bookedBy: gifter,
        givenByMe: false,
      });
      const released = await patchItem(gifter, lego, { status: 'available' });
      expect(released.status).toBe(200);
      const rebooked = await patchItem(gifter, lego, { status: 'booked' });
      expect(rebooked.status).toBe(200);
      expect(rebooked.body.data).toMatchObject({ givenByMe: false });

      expect(errorLog).toHaveBeenCalledWith('Reading which booked items were given failed:', {
        name: 'MongoServerError',
        code: 6,
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(gifter);
    } finally {
      distinct.mockRestore();
      errorLog.mockRestore();
    }
  });

  // Deleting the entry from the gift history (a mistaken "Mark as gifted")
  // takes the flag with it, so the card offers Unbook again.
  it('goes once the gifter deletes the gift-history entry', async () => {
    await bookAndGive('Lego set');
    await GiftLog.deleteMany({ gifter });
    expect(byName(await listItems(gifter))['Lego set']).toMatchObject({
      bookedBy: gifter,
      givenByMe: false,
    });
  });
});
