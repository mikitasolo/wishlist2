import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// connectDB becomes a no-op; the in-memory mongoose connection backs the models.
vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// Avoid pulling env/adapter/nodemailer via the real auth module.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Don't hit the DB/external API for currency rates.
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH, DELETE } from '@/app/api/items/[id]/route';
import { GET as LIST_ITEMS, POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { GET as MY_ITEMS } from '@/app/api/users/me/items/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);

function patch(id: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/items/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function create(body: unknown) {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return CREATE_ITEM(req, { params: Promise.resolve({ id: wishlistId }) });
}

let ownerId: string;
let memberId: string;
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const member = await User.create({ email: 'member@x.com', username: 'member' });
  ownerId = owner._id.toString();
  memberId = member._id.toString();
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'everyone' });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: member._id, role: 'member' });
});

async function makeItem(status = 'available', bookedBy?: string) {
  const item = await Item.create({
    wishlist: wishlistId,
    name: 'Gift',
    status,
    bookedBy: bookedBy ?? undefined,
  });
  return item._id.toString();
}

describe('PATCH /api/items/[id] — booking & reservations', () => {
  it('member booking creates a Reservation and marks the item booked', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');

    const res = await patch(id, { status: 'booked' });
    expect(res.status).toBe(200);

    const item = await Item.findById(id);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(memberId);

    const reservation = await Reservation.findOne({ gifter: memberId, item: id });
    expect(reservation).not.toBeNull();
    expect(reservation?.owner.toString()).toBe(ownerId);
    expect(reservation?.itemName).toBe('Gift');
  });

  it('member unbooking removes their Reservation', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    await patch(id, { status: 'booked' });

    await patch(id, { status: 'available' });
    const item = await Item.findById(id);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.findOne({ gifter: memberId, item: id })).toBeNull();
  });

  it('a non-member cannot book', async () => {
    const stranger = await User.create({ email: 's@x.com', username: 'stranger' });
    session.mockResolvedValue({ user: { id: stranger._id.toString() } } as never);
    const id = await makeItem('available');
    const res = await patch(id, { status: 'booked' });
    expect(res.status).toBe(403);
  });
});

// regression (WIS-431): the price's currency was checked before the role rules,
// so a member was refused a 400 for a price their role can never write.
describe('PATCH /api/items/[id] — currency checked only on a price the edit writes', () => {
  const badPrice = { value: 1000, currency: 'XXX' };

  it("a member's reserve with a price in an unknown currency goes through, the price ignored", async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    const res = await patch(id, { status: 'booked', price: badPrice });
    expect(res.status).toBe(200);
    const item = await Item.findById(id);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(item?.price ?? null).toBeNull();
    expect(await Reservation.countDocuments({ gifter: memberId, item: id })).toBe(1);
  });

  it("a member sending only a price gets the role's 403, not the currency's 400", async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    const res = await patch(id, { price: badPrice });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'Insufficient permissions to update these fields',
    });
    expect((await Item.findById(id))?.price ?? null).toBeNull();
  });

  it("an owner's price in an unknown currency is still refused, nothing written", async () => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const id = await makeItem('available');
    const res = await patch(id, { name: 'Renamed', price: badPrice });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Currency 'XXX' is not supported. Please use a supported currency code.",
    });
    const item = await Item.findById(id);
    expect(item?.name).toBe('Gift');
    expect(item?.price ?? null).toBeNull();
  });

  it("an owner's edit refused for its currency writes none of its links either", async () => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const id = await makeItem('available');
    const other = await makeItem('available');
    const res = await patch(id, { linkItems: [other], price: badPrice });
    expect(res.status).toBe(400);
    expect((await Item.findById(id))?.relatedItems ?? []).toHaveLength(0);
    expect((await Item.findById(other))?.relatedItems ?? []).toHaveLength(0);
  });

  it("a proposer's edit of their proposal is still refused a price in an unknown currency", async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const proposal = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: memberId,
    });
    const res = await patch(proposal._id.toString(), { price: badPrice });
    expect(res.status).toBe(400);
    expect((await Item.findById(proposal._id))?.price ?? null).toBeNull();
  });

  it("an owner's price in a known currency lands", async () => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const id = await makeItem('available');
    const res = await patch(id, { price: { value: 1000, currency: 'usd' } });
    expect(res.status).toBe(200);
    expect((await Item.findById(id))?.price).toMatchObject({ value: 1000, currency: 'USD' });
  });
});

describe('PATCH /api/items/[id] — owner edits do not clobber bookings', () => {
  // Regression: editing a booked item used to send status and wipe the booking.
  it('regression: owner renaming a booked item keeps it booked and reserved', async () => {
    // member books first
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    await patch(id, { status: 'booked' });

    // owner edits the name only
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const res = await patch(id, { name: 'Renamed' });
    expect(res.status).toBe(200);

    const item = await Item.findById(id);
    expect(item?.name).toBe('Renamed');
    expect(item?.status).toBe('booked'); // booking preserved
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(await Reservation.findOne({ gifter: memberId, item: id })).not.toBeNull();
  });
});

describe('PATCH /api/items/[id] — publish / move to draft', () => {
  it('owner can publish a draft', async () => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const id = await makeItem('draft');
    const res = await patch(id, { status: 'available' });
    expect(res.status).toBe(200);
    expect((await Item.findById(id))?.status).toBe('available');
  });

  // Regression: owner status changes must NOT delete the gifter's durable
  // Reservation (that's what lets them still log the gift). Moving to draft
  // clears the live booking but the Reservation survives.
  it('regression: moving a booked item to draft clears bookedBy but keeps the Reservation', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    await patch(id, { status: 'booked' });

    session.mockResolvedValue({ user: { id: ownerId } } as never);
    await patch(id, { status: 'draft' });

    const item = await Item.findById(id);
    expect(item?.status).toBe('draft');
    expect(item?.bookedBy).toBeNull();
    // Reservation persists so the gifter can still log the gift.
    expect(await Reservation.findOne({ gifter: memberId, item: id })).not.toBeNull();
  });

  it('regression: completing a booked item clears bookedBy but keeps the Reservation', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const id = await makeItem('available');
    await patch(id, { status: 'booked' });

    session.mockResolvedValue({ user: { id: ownerId } } as never);
    await patch(id, { status: 'completed' });

    const item = await Item.findById(id);
    expect(item?.status).toBe('completed');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.findOne({ gifter: memberId, item: id })).not.toBeNull();
  });

  // What an owner's answer says about an item, less what tells two items apart.
  const ownerAnswer = async (res: Response) => {
    const { data, ...rest } = await res.json();
    const { _id, createdAt, updatedAt, ...fields } = data;
    return { ...rest, data: fields };
  };

  // regression (WIS-108): an owner's `available` (Publish, Reopen) released any
  // booking, so one sent from a stale view (a co-owner published the item and a
  // member booked it since) left it bookable again while its gifter still held
  // a Reservation: a second member could then book it too.
  it("regression: publishing or reopening a booked item keeps the member's booking, with the answer an unbooked item gets", async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const bookedId = await makeItem('available');
    await patch(bookedId, { status: 'booked' });
    const freeId = await makeItem('available');

    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const onBooked = await patch(bookedId, { status: 'available' });
    const onFree = await patch(freeId, { status: 'available' });
    expect(onBooked.status).toBe(200);
    expect(onFree.status).toBe(200);
    expect(await ownerAnswer(onBooked)).toEqual(await ownerAnswer(onFree));

    const item = await Item.findById(bookedId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(await Reservation.findOne({ gifter: memberId, item: bookedId })).not.toBeNull();
  });

  it('regression: a content edit sent with the publish still lands on a booked item, and the booking stays', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const bookedId = await makeItem('available');
    await patch(bookedId, { status: 'booked' });
    const freeId = await makeItem('draft');

    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const body = { status: 'available', name: 'Renamed', mostWanted: true };
    const onBooked = await patch(bookedId, body);
    const onFree = await patch(freeId, body);
    expect(onBooked.status).toBe(200);
    expect(await ownerAnswer(onBooked)).toEqual(await ownerAnswer(onFree));

    const item = await Item.findById(bookedId);
    expect([item?.name, item?.mostWanted, item?.status]).toEqual(['Renamed', true, 'booked']);
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(await Reservation.findOne({ gifter: memberId, item: bookedId })).not.toBeNull();
  });

  it('publishing an item deleted since it was read is still a 404', async () => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const id = await makeItem('draft');
    const spy = vi.spyOn(Item, 'findById').mockImplementationOnce((() => {
      const read = Item.findOne({ _id: id });
      return read.then(async (doc) => {
        await Item.deleteOne({ _id: id });
        return doc;
      });
    }) as never);
    const res = await patch(id, { status: 'available' });
    spy.mockRestore();
    expect(res.status).toBe(404);
  });
});

// regression: the owner branch of PATCH took `status` and `bookedBy` as given.
// `booked` (with or without a `bookedBy`) or a `bookedBy` alone stored a booking
// with no Reservation behind it, which nobody can release (only the holder can
// unbook, owners are booking-blind), and `proposed` turned a live item into a
// proposal with no proposer.
describe('PATCH /api/items/[id] — owner edits never book or propose an item', () => {
  const as = (userId: string) => session.mockResolvedValue({ user: { id: userId } } as never);

  // The item has `status`, and neither a booker nor a proposer.
  async function expectNoBookerOrProposer(id: string, status: string) {
    const item = await Item.findById(id);
    expect(item?.status).toBe(status);
    expect(item?.bookedBy ?? null).toBeNull();
    expect(item?.proposedBy ?? null).toBeNull();
  }

  it('regression: status booked, with or without bookedBy, is a 400 and books nothing', async () => {
    as(ownerId);
    for (const status of ['draft', 'available', 'completed']) {
      const id = await makeItem(status);
      for (const body of [{ status: 'booked', bookedBy: memberId }, { status: 'booked' }]) {
        expect((await patch(id, body)).status).toBe(400);
        await expectNoBookerOrProposer(id, status);
      }
    }
    expect(await Reservation.countDocuments()).toBe(0);
  });

  it('regression: status proposed on a live item is a 400 and leaves it live', async () => {
    as(ownerId);
    for (const status of ['draft', 'available', 'completed']) {
      const id = await makeItem(status);
      expect((await patch(id, { status: 'proposed' })).status).toBe(400);
      await expectNoBookerOrProposer(id, status);
    }
  });

  it('regression: a bookedBy is ignored, alongside other fields or on its own', async () => {
    as(ownerId);
    const id = await makeItem('available');

    // On its own there is nothing left to update, so the request is refused.
    expect((await patch(id, { bookedBy: memberId })).status).toBe(400);
    await expectNoBookerOrProposer(id, 'available');

    const res = await patch(id, { name: 'Renamed', bookedBy: memberId });
    expect(res.status).toBe(200);
    expect((await Item.findById(id))?.name).toBe('Renamed');
    await expectNoBookerOrProposer(id, 'available');
    expect(await Reservation.countDocuments()).toBe(0);
  });

  it("regression: can't take over or strand a member's booking, and is refused as if unbooked", async () => {
    as(memberId);
    const bookedId = await makeItem('available');
    await patch(bookedId, { status: 'booked' });
    const freeId = await makeItem('available');

    as(ownerId);
    // Same answer for a booked and an unbooked item: it mustn't reveal the booking.
    const onBooked = await patch(bookedId, { status: 'booked', bookedBy: ownerId });
    const onFree = await patch(freeId, { status: 'booked', bookedBy: ownerId });
    expect(onBooked.status).toBe(400);
    expect(await onBooked.json()).toEqual(await onFree.json());

    // Clearing or reassigning bookedBy used to leave it booked by nobody, or by
    // someone with no Reservation.
    for (const bookedBy of [null, ownerId]) {
      expect((await patch(bookedId, { notes: 'Blue', bookedBy })).status).toBe(200);
    }
    const item = await Item.findById(bookedId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(await Reservation.findOne({ gifter: memberId, item: bookedId })).not.toBeNull();
  });

  // regression: a status change only cleared bookedBy when the route's earlier
  // read saw the item `booked`, so a booker set without a booking (the old
  // `{ bookedBy }`-alone write, or a member booking in between) survived it.
  it('regression: every owner status change clears a stray bookedBy', async () => {
    as(ownerId);
    for (const status of ['draft', 'completed', 'available']) {
      const id = await makeItem('available', memberId);
      expect((await patch(id, { status })).status).toBe(200);
      await expectNoBookerOrProposer(id, status);
    }
  });

  it('still publishes, moves to draft, completes and reopens', async () => {
    as(ownerId);
    const id = await makeItem('draft');
    for (const status of ['available', 'draft', 'available', 'completed', 'available']) {
      expect((await patch(id, { status })).status).toBe(200);
      await expectNoBookerOrProposer(id, status);
    }
  });
});

describe('PATCH /api/items/[id] — proposal anonymity', () => {
  async function makeProposed() {
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Proposed',
      status: 'proposed',
      proposedBy: memberId,
    });
    return item._id.toString();
  }

  // regression: the PATCH reply must never leak the proposer to the owner —
  // proposals are anonymous to the owner. GET hid `proposedBy`; this closes the
  // single-item PATCH response, which returned the raw item.
  it('does not return proposedBy to the owner when editing a proposed item', async () => {
    const id = await makeProposed();
    session.mockResolvedValue({ user: { id: ownerId } } as never);

    const res = await patch(id, { name: 'Renamed by owner' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Renamed by owner');
    expect(body.data.status).toBe('proposed'); // not approved, just edited
    expect(body.data.proposedBy).toBeUndefined();
    // The DB still records the proposer (only the response is sanitized).
    expect((await Item.findById(id))?.proposedBy?.toString()).toBe(memberId);
  });

  it('lets the proposer see their own proposedBy in the reply', async () => {
    const id = await makeProposed();
    session.mockResolvedValue({ user: { id: memberId } } as never);

    const res = await patch(id, { name: 'Edited by proposer' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.proposedBy).toBe(memberId);
  });
});

// regression: createItemSchema accepted `bookedBy` plus a `booked` / `completed`
// status, and POST wrote `bookedBy` as given. That let a create produce a booking
// with no Reservation behind it (nobody can release it: only the holder can
// unbook and owners are booking-blind), and a proposal carry a stray `bookedBy`
// that approving it kept on the live item.
describe('Creating an item never books it', () => {
  const as = (userId: string) => session.mockResolvedValue({ user: { id: userId } } as never);

  it("regression: a member's proposal with bookedBy stores no bookedBy", async () => {
    as(memberId);
    const res = await create({ name: 'Idea', status: 'proposed', bookedBy: ownerId });
    expect(res.status).toBe(201);

    const item = await Item.findById((await res.json()).data._id);
    expect(item?.status).toBe('proposed');
    expect(item?.bookedBy).toBeNull();
  });

  it("regression: an owner's create with bookedBy stores no bookedBy", async () => {
    as(ownerId);
    const res = await create({ name: 'Bike', status: 'available', bookedBy: memberId });
    expect(res.status).toBe(201);

    const item = await Item.findById((await res.json()).data._id);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.countDocuments()).toBe(0);
  });

  it('regression: a create with status booked or completed is a 400, and stores nothing', async () => {
    for (const userId of [ownerId, memberId]) {
      as(userId);
      for (const status of ['booked', 'completed']) {
        const res = await create({ name: 'Gift', status, bookedBy: memberId });
        expect(res.status).toBe(400);
      }
    }
    expect(await Item.countDocuments()).toBe(0);
  });

  it('owners still create drafts and available items, and members still propose', async () => {
    as(ownerId);
    expect((await create({ name: 'Draft', status: 'draft' })).status).toBe(201);
    expect((await create({ name: 'Live', status: 'available' })).status).toBe(201);
    expect((await create({ name: 'Default' })).status).toBe(201);
    as(memberId);
    expect((await create({ name: 'Idea', status: 'proposed' })).status).toBe(201);

    const items = await Item.find().sort({ name: 1 }).lean();
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ['Default', 'available'],
      ['Draft', 'draft'],
      ['Idea', 'proposed'],
      ['Live', 'available'],
    ]);
    expect(items.every((i) => i.bookedBy == null)).toBe(true);
  });

  // regression: approving a proposal kept any `bookedBy` it carried, leaving the
  // live item `available` with a stray booker. Rows written before creates
  // dropped `bookedBy` can still hold one.
  it('regression: approving a proposal (to available or draft) leaves bookedBy null', async () => {
    as(ownerId);
    for (const status of ['available', 'draft'] as const) {
      // Insert directly, as an old create would have stored it.
      const proposal = await Item.create({
        wishlist: wishlistId,
        name: `Idea for ${status}`,
        status: 'proposed',
        proposedBy: memberId,
        bookedBy: memberId,
      });

      const res = await patch(proposal._id.toString(), { status });
      expect(res.status).toBe(200);

      const item = await Item.findById(proposal._id);
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      expect(item?.proposedBy).toBeNull();
    }
  });
});

describe('POST /api/wishlists/[id]/items and PATCH /api/items/[id] — name validation', () => {
  const as = (userId: string) => session.mockResolvedValue({ user: { id: userId } } as never);

  // regression: the schemas checked the name's length before trimming it, so
  // "   " passed as a name and trimmed to "". The model's `required` then
  // refused it inside the route: a 500 instead of a 400.
  it('regression: a create or proposal whose name is only spaces is a 400, and stores nothing', async () => {
    for (const [userId, status] of [
      [ownerId, 'available'],
      [memberId, 'proposed'],
    ] as const) {
      as(userId);
      const res = await create({ name: '   ', status });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Validation error: name: Item name is required');
    }
    expect(await Item.countDocuments()).toBe(0);
  });

  it('regression: renaming an item to a name that is only spaces is a 400, and keeps the old name', async () => {
    as(ownerId);
    const id = await makeItem('available');

    const res = await patch(id, { name: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation error: name: Item name is required');
    expect((await Item.findById(id))?.name).toBe('Gift');
  });
});

describe('Most wanted flag', () => {
  const as = (userId: string) => session.mockResolvedValue({ user: { id: userId } } as never);

  async function list() {
    const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`);
    const res = await LIST_ITEMS(req, { params: Promise.resolve({ id: wishlistId }) });
    return (await res.json()).data as { name: string; mostWanted?: boolean }[];
  }

  const flagOf = async (id: string) => (await Item.findById(id).lean())?.mostWanted;

  it('an owner can create an item as most wanted; it defaults to false', async () => {
    as(ownerId);
    const flagged = await create({ name: 'Bike', mostWanted: true });
    expect(flagged.status).toBe(201);
    expect(await flagOf((await flagged.json()).data._id)).toBe(true);

    const plain = await create({ name: 'Socks' });
    expect(await flagOf((await plain.json()).data._id)).toBe(false);
  });

  it('an owner can set and clear it on an existing item', async () => {
    as(ownerId);
    const id = await makeItem('available');

    const set = await patch(id, { mostWanted: true });
    expect(set.status).toBe(200);
    expect((await set.json()).data.mostWanted).toBe(true);
    expect(await flagOf(id)).toBe(true);

    await patch(id, { mostWanted: false });
    expect(await flagOf(id)).toBe(false);
  });

  it("flagging a booked item keeps the member's booking and reservation", async () => {
    as(memberId);
    const id = await makeItem('available');
    await patch(id, { status: 'booked' });

    as(ownerId);
    const res = await patch(id, { mostWanted: true });
    expect(res.status).toBe(200);
    // The owner still sees it as available: bookings stay hidden from owners.
    expect((await res.json()).data.status).toBe('available');

    const item = await Item.findById(id);
    expect(item?.mostWanted).toBe(true);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(memberId);
    expect(await Reservation.findOne({ gifter: memberId, item: id })).not.toBeNull();
  });

  it('a member cannot flag an item', async () => {
    as(memberId);
    const id = await makeItem('available');

    expect((await patch(id, { mostWanted: true })).status).toBe(403);
    expect(await flagOf(id)).toBe(false);

    // Riding along with a booking doesn't work either.
    expect((await patch(id, { status: 'booked', mostWanted: true })).status).toBe(200);
    const item = await Item.findById(id);
    expect(item?.status).toBe('booked');
    expect(item?.mostWanted).toBe(false);
  });

  it("a member's proposal starts unflagged, and the proposer can't flag it later", async () => {
    as(memberId);
    const res = await create({ name: 'Idea', status: 'proposed', mostWanted: true });
    expect(res.status).toBe(201);
    const id = (await res.json()).data._id;
    expect(await flagOf(id)).toBe(false);

    await patch(id, { mostWanted: true });
    expect(await flagOf(id)).toBe(false);
  });

  it('an owner can flag a proposal while approving it', async () => {
    const proposal = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: memberId,
    });
    const id = proposal._id.toString();

    as(ownerId);
    expect((await patch(id, { status: 'available', mostWanted: true })).status).toBe(200);
    const item = await Item.findById(id);
    expect(item?.status).toBe('available');
    expect(item?.mostWanted).toBe(true);
  });

  it('everyone who can see the item sees the flag', async () => {
    await Item.create({
      wishlist: wishlistId,
      name: 'Bike',
      status: 'available',
      mostWanted: true,
    });

    for (const viewer of [ownerId, memberId, null]) {
      session.mockResolvedValue((viewer ? { user: { id: viewer } } : null) as never);
      expect((await list()).map((i) => i.mostWanted)).toEqual([true]);
    }
  });

  // An item saved before the field existed has no mostWanted in the database.
  it('reports false for an item saved before the flag existed', async () => {
    await Item.collection.insertOne({
      wishlist: new mongoose.Types.ObjectId(wishlistId),
      name: 'Legacy',
      status: 'available',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    as(ownerId);
    expect((await list()).map((i) => i.mostWanted)).toEqual([false]);

    const mine = await MY_ITEMS(new NextRequest('http://localhost/api/users/me/items'));
    expect((await mine.json()).data.map((i: { mostWanted: unknown }) => i.mostWanted)).toEqual([
      false,
    ]);
  });
});

describe('GET /api/users/me/items', () => {
  // /items sorts with the wishlist page's sorter, whose date sorts read createdAt.
  it("returns each item's createdAt, and the rest of the item as before", async () => {
    const bike = await Item.create({
      wishlist: wishlistId,
      name: 'Bike',
      status: 'booked',
      bookedBy: memberId,
      mostWanted: true,
    });
    const slug = (await Wishlist.findById(wishlistId).lean())?.slug ?? null;

    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const res = await MY_ITEMS(new NextRequest('http://localhost/api/users/me/items'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toStrictEqual([
      {
        _id: bike._id.toString(),
        name: 'Bike',
        imageUrl: null,
        price: null,
        priceInUsdCents: null,
        link: null,
        mostWanted: true,
        status: 'available', // an owner never sees a booking
        wishlistId,
        wishlistSlug: slug,
        wishlistName: 'List',
        wishlistArchived: false,
        createdAt: bike.createdAt.toISOString(),
      },
    ]);
  });
});

describe('/api/items/[id] — a malformed id', () => {
  function remove(id: string) {
    const req = new NextRequest('http://localhost/api/items/' + id, { method: 'DELETE' });
    return DELETE(req, { params: Promise.resolve({ id }) });
  }

  // regression: a malformed id made `findById` throw a CastError, so PATCH and
  // DELETE answered 500 ("Failed to update item" / "Failed to delete item")
  // instead of the 404 a missing item gets.
  it.each(['not-an-id', '12345', 'z'.repeat(24)])(
    'regression: PATCH and DELETE answer 404 for a malformed item id (%s)',
    async (badId) => {
      const id = await makeItem('available');

      for (const userId of [ownerId, memberId]) {
        session.mockResolvedValue({ user: { id: userId } } as never);
        for (const res of [await patch(badId, { status: 'booked' }), await remove(badId)]) {
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ success: false, error: 'Item not found' });
        }
      }
      expect((await Item.findById(id))?.status).toBe('available');
    }
  );

  it('answers a signed-out caller with the 401, before looking at the id', async () => {
    session.mockResolvedValue(null as never);

    expect((await patch('not-an-id', { status: 'booked' })).status).toBe(401);
    expect((await remove('not-an-id')).status).toBe(401);
  });
});
