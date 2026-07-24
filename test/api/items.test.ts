import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// connectDB becomes a no-op; the in-memory mongoose connection backs the models.
vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// Avoid pulling env/adapter/nodemailer via the real auth module.
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
// Don't hit the DB/external API for currency rates.
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
}));

import { getServerSession } from 'next-auth';
import { PATCH } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(getServerSession);

function patch(id: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/items/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
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
  const wl = await Wishlist.create({ name: 'List', owner: owner._id, visibility: 'everyone' });
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
});
