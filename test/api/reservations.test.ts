import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as GIFT } from '@/app/api/reservations/[id]/gift/route';
import { DELETE as DISMISS } from '@/app/api/reservations/[id]/route';
import { DELETE as DELETE_GIFT } from '@/app/api/gifts/[id]/route';
import { GET as LIST_GIFTS } from '@/app/api/users/me/gifts/route';
import User from '@/models/User';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import Wishlist from '@/models/Wishlist';

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

function call(
  handler: typeof GIFT | typeof DISMISS | typeof DELETE_GIFT,
  id: string,
  method = 'POST'
) {
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

  // The Booked page adds the answer's entry to its gift history as is, rather
  // than re-reading the list, so it must be the entry the list would hold.
  it.each([
    {
      wishlist: 'a live wishlist',
      setUp: async () => {
        const wishlist = await Wishlist.create({
          name: 'Birthday',
          owners: [ownerId],
          slug: 'birthday-a1b2c',
        });
        await Reservation.updateOne(
          { _id: reservationId },
          {
            wishlist: wishlist._id,
            itemImage: 'https://shop.example/mug.png',
            itemPrice: { value: 1250, currency: 'usd' },
          }
        );
        return {
          wishlistId: wishlist._id.toString(),
          wishlistSlug: 'birthday-a1b2c',
          itemImage: 'https://shop.example/mug.png',
          itemPrice: { value: 1250, currency: 'usd' },
        };
      },
    },
    {
      // The reservation from beforeEach points at a wishlist with no row.
      wishlist: 'a deleted wishlist',
      setUp: async () => ({
        wishlistId: '507f1f77bcf86cd799439011',
        wishlistSlug: null,
        itemImage: null,
        itemPrice: null,
      }),
    },
  ])(
    'answers with the new entry as the gift history lists it, for $wishlist',
    async ({ setUp }) => {
      const expected = await setUp();
      session.mockResolvedValue({ user: { id: gifterId } } as never);

      const res = await call(GIFT, reservationId, 'POST');
      expect(res.status).toBe(201);
      const { data } = await res.json();

      const entry = await GiftLog.findOne({ gifter: gifterId });
      expect(data).toEqual({
        _id: entry!._id.toString(),
        itemName: 'Blue Mug',
        recipientUsername: 'owner',
        wishlistName: 'Birthday',
        giftedAt: entry!.giftedAt.toISOString(),
        ...expected,
      });
      const history = await (await LIST_GIFTS()).json();
      expect(history.data).toEqual([data]);
    }
  );

  // The answer's wishlist slug is read before the entry is written, so failing
  // to read it is a gift that can be retried, not a 500 for a logged one.
  it("keeps the reservation and logs nothing when the answer's slug can't be read", async () => {
    session.mockResolvedValue({ user: { id: gifterId } } as never);
    const find = vi
      .spyOn(Wishlist, 'find')
      .mockImplementationOnce(
        () => ({ select: () => Promise.reject(new Error('db down')) }) as never
      );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await call(GIFT, reservationId, 'POST')).status).toBe(500);
    } finally {
      find.mockRestore();
      errorLog.mockRestore();
    }

    expect(await GiftLog.countDocuments()).toBe(0);
    expect((await Reservation.findById(reservationId))?.itemName).toBe('Blue Mug');
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

describe('a malformed reservation or gift id', () => {
  // regression: a malformed id made the lookup throw a CastError, so these routes
  // answered 500 ("Failed to log gift" / "Failed to dismiss reservation" /
  // "Failed to delete gift entry") instead of their "not found" 404.
  it.each([
    ['POST /api/reservations/[id]/gift', GIFT, 'POST', 'Reservation not found'],
    ['DELETE /api/reservations/[id]', DISMISS, 'DELETE', 'Reservation not found'],
    ['DELETE /api/gifts/[id]', DELETE_GIFT, 'DELETE', 'Gift entry not found'],
  ] as const)('regression: %s answers 404', async (_route, handler, method, error) => {
    await GiftLog.create({ gifter: gifterId, giftedAt: new Date(), itemName: 'Old gift' });
    session.mockResolvedValue({ user: { id: gifterId } } as never);

    for (const badId of ['not-an-id', '12345', 'z'.repeat(24)]) {
      const res = await call(handler, badId, method);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error });
    }
    expect(await Reservation.countDocuments()).toBe(1);
    expect(await GiftLog.countDocuments()).toBe(1);
  });

  it('answers a signed-out caller with the 401, before looking at the id', async () => {
    session.mockResolvedValue(null as never);

    expect((await call(GIFT, 'not-an-id', 'POST')).status).toBe(401);
    expect((await call(DISMISS, 'not-an-id', 'DELETE')).status).toBe(401);
    expect((await call(DELETE_GIFT, 'not-an-id', 'DELETE')).status).toBe(401);
  });
});
