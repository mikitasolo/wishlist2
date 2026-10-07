import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
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
import WishlistMember from '@/models/WishlistMember';
import Follow from '@/models/Follow';

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
  // than re-reading the list, so it must be the entry the list would hold. That
  // entry is the GiftLog's snapshot and its list's id, with no slug to link the
  // list by, whatever the gifter's access to the list now.
  it.each([
    {
      wishlist: 'a wishlist the gifter may open',
      setUp: async () => {
        // Public, so the gifter, who isn't a member, may still open it.
        const wishlist = await Wishlist.create({
          name: 'Birthday',
          owners: [ownerId],
          slug: 'birthday-a1b2c',
          visibility: 'everyone',
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
          itemImage: 'https://shop.example/mug.png',
          itemPrice: { value: 1250, currency: 'usd' },
        };
      },
    },
    {
      // Private, and the gifter is no member (say they were kicked): the
      // Reservation outlives that, so the gift can still be logged.
      wishlist: 'a wishlist the gifter may no longer open',
      setUp: async () => {
        const wishlist = await Wishlist.create({
          name: 'Anna’s 30th',
          owners: [ownerId],
          slug: 'annas-30th',
          visibility: 'private',
        });
        await Reservation.updateOne({ _id: reservationId }, { wishlist: wishlist._id });
        return { wishlistId: wishlist._id.toString(), itemImage: null, itemPrice: null };
      },
    },
    {
      // The reservation from beforeEach points at a wishlist with no row.
      wishlist: 'a deleted wishlist',
      setUp: async () => ({
        wishlistId: '507f1f77bcf86cd799439011',
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
      // Exactly these fields: no `wishlistSlug`, nor anything else read live.
      expect(data).toStrictEqual({
        _id: entry!._id.toString(),
        itemName: 'Blue Mug',
        recipientUsername: 'owner',
        // The snapshot's name, never the live list's.
        wishlistName: 'Birthday',
        giftedAt: entry!.giftedAt.toISOString(),
        ...expected,
      });
      const history = await (await LIST_GIFTS()).json();
      expect(history.data).toStrictEqual([data]);
    }
  );

  // The answer used to read the entry's list (for its slug) once the gift was
  // logged, a read that could fail after the gift had landed. Neither it nor
  // the history reads any list, membership or friendship now, so no list read
  // can change or fail either answer. (Marking reads the gifter's access to the
  // list only for an image that's the item's own blob, before the entry is
  // written: `giftLogImage`, WIS-359.)
  it('answers, and lists the history, without reading any list', async () => {
    const wishlist = await Wishlist.create({
      name: 'Birthday',
      owners: [ownerId],
      slug: 'birthday-a1b2c',
      visibility: 'everyone',
    });
    await Reservation.updateOne({ _id: reservationId }, { wishlist: wishlist._id });
    session.mockResolvedValue({ user: { id: gifterId } } as never);

    const queried = new Set<string>();
    mongoose.set('debug', (collection: string) => {
      queried.add(collection);
    });
    let gift, history;
    try {
      gift = await call(GIFT, reservationId, 'POST');
      history = await LIST_GIFTS();
    } finally {
      mongoose.set('debug', false);
    }

    expect(gift.status).toBe(201);
    expect(history.status).toBe(200);
    expect((await history.json()).data).toStrictEqual([(await gift.json()).data]);
    for (const model of [Wishlist, WishlistMember, Follow]) {
      expect(queried).not.toContain(model.collection.collectionName);
    }
    // The hook did see the routes' own queries.
    expect(queried).toContain(GiftLog.collection.collectionName);
    expect(await Reservation.findById(reservationId)).toBeNull();
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
