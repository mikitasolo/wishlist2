import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as GIFT } from '@/app/api/reservations/[id]/gift/route';
import { DELETE as DISMISS } from '@/app/api/reservations/[id]/route';
import User from '@/models/User';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

const session = vi.mocked(auth);

let gifterId: string;
let ownerId: string;
let itemId: string;
let reservationId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const gifter = await User.create({ email: 'g@x.com', username: 'gifter' });
  const owner = await User.create({ email: 'o@x.com', username: 'owner' });
  gifterId = gifter._id.toString();
  ownerId = owner._id.toString();
  const item = await Item.create({
    wishlist: '507f1f77bcf86cd799439011',
    name: 'Blue Mug',
    status: 'booked',
    bookedBy: gifter._id,
  });
  itemId = item._id.toString();
  const r = await Reservation.create({
    gifter: gifter._id,
    wishlist: '507f1f77bcf86cd799439011',
    item: item._id,
    owner: owner._id,
    itemName: 'Blue Mug',
    wishlistName: 'Birthday',
  });
  reservationId = r._id.toString();
});

function call(handler: typeof GIFT | typeof DISMISS, id: string, method = 'POST') {
  const req = new NextRequest('http://localhost/api/reservations/' + id, { method });
  return handler(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/reservations/[id]/gift', () => {
  // Regression: marking a gift writes a permanent GiftLog and removes the
  // reservation, but must NOT touch the owner's live item.
  it('regression: logs the gift, deletes the reservation, leaves the item untouched', async () => {
    session.mockResolvedValue({ user: { id: gifterId } } as never);
    const res = await call(GIFT, reservationId, 'POST');
    expect(res.status).toBe(201);

    const gift = await GiftLog.findOne({ gifter: gifterId });
    expect(gift).not.toBeNull();
    expect(gift?.itemName).toBe('Blue Mug');
    expect(gift?.recipientUsername).toBe('owner');

    // reservation gone
    expect(await Reservation.findById(reservationId)).toBeNull();

    // item untouched — still booked by the gifter
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(gifterId);
  });

  it("cannot gift someone else's reservation", async () => {
    const other = await User.create({ email: 'x@x.com', username: 'other' });
    session.mockResolvedValue({ user: { id: other._id.toString() } } as never);
    const res = await call(GIFT, reservationId, 'POST');
    expect(res.status).toBe(404);
    expect(await Reservation.findById(reservationId)).not.toBeNull();
    expect(await GiftLog.countDocuments()).toBe(0);
  });
});

describe('DELETE /api/reservations/[id] (dismiss)', () => {
  it('removes the reservation without creating a GiftLog', async () => {
    session.mockResolvedValue({ user: { id: gifterId } } as never);
    const res = await call(DISMISS, reservationId, 'DELETE');
    expect(res.status).toBe(200);
    expect(await Reservation.findById(reservationId)).toBeNull();
    expect(await GiftLog.countDocuments()).toBe(0);
  });

  it('cannot dismiss a reservation that is not yours', async () => {
    const other = await User.create({ email: 'x@x.com', username: 'other' });
    session.mockResolvedValue({ user: { id: other._id.toString() } } as never);
    const res = await call(DISMISS, reservationId, 'DELETE');
    expect(res.status).toBe(404);
    expect(await Reservation.findById(reservationId)).not.toBeNull();
  });
});
