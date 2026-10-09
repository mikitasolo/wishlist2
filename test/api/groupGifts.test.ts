import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// WIS-361: group gifts. Members split one item; the item is booked by the
// organizer, every contributor holds a Reservation, owners and anyone off the
// list never learn of it, and every write is conditional on the gift as it is.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// WIS-364: group gift actions now email their contributors.
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    rates: new Map([
      ['usd', 1],
      ['eur', 0.9],
    ]),
  }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@vercel/blob', () => ({ copy: vi.fn(), del: vi.fn(), list: vi.fn(), put: vi.fn() }));

import { DELETE as deleteWishlistRoute } from '@/app/api/wishlists/[id]/route';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import GroupGift from '@/models/GroupGift';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import { __setRateLimiters } from '@/lib/rateLimit';
import { GROUP_GIFT_UNBOOK_ERROR } from '@/lib/utils/groupGifts';
import {
  GROUP_GIFT_ENDED,
  GROUP_GIFT_NONE,
  GROUP_GIFT_NOT_AVAILABLE,
  GROUP_GIFT_ORGANIZER_ONLY,
  GROUP_GIFT_OWNER_ERROR,
  GROUP_GIFT_TARGET_REQUIRED,
} from '@/lib/utils/groupGiftRoutes';
import {
  api,
  expectEveryBookingReleasable,
  liveGift,
  as,
  json,
  seedWorld,
  session,
  type World,
} from './groupGiftHarness';

let w: World;
const a = api(() => w);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  __setRateLimiters(null);
  w = await seedWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const reservationsOf = async () =>
  (await Reservation.find({ item: w.itemId }).lean()).map((r) => r.gifter.toString()).sort();
const itemNow = () => Item.findById(w.itemId).lean();
const ownerVisibleJson = async () => JSON.stringify(await (await a.readItems(w.owner)).json());

describe('POST /api/items/[id]/group-gift — start', () => {
  it('books the item to the organizer, who is the first contributor and holds a Reservation', async () => {
    const res = await a.start(w.alice, { pledged: 3000 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('booked');
    expect(body.data.bookedBy).toBe(w.alice);
    expect(body.data.groupGift).toEqual({
      contributing: true,
      organizer: true,
      status: 'open',
      target: { value: 10000, currency: 'USD' },
      pledgedTotal: 3000,
      percentFunded: 30,
      contributors: [{ name: 'alice', pledged: 3000, organizer: true, you: true }],
    });
    // Never the stored link to the gift.
    expect(body.data).not.toHaveProperty('groupGiftRev');
    expect(typeof body.data.groupGift.id).toBe('undefined');

    const item = await itemNow();
    const gift = await liveGift(w.itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(w.alice);
    expect(item?.groupGift?.toString()).toBe(gift?._id.toString());
    expect(gift?.organizer.toString()).toBe(w.alice);
    expect(gift?.target).toEqual({ value: 10000, currency: 'USD' });
    expect(await reservationsOf()).toEqual([w.alice]);
    await expectEveryBookingReleasable(w.wishlistId);
  });

  it('takes a target (currency normalized) and needs one for an item with no price', async () => {
    await Item.updateOne({ _id: w.itemId }, { $unset: { price: 1 } });
    const none = await a.start(w.alice, { pledged: 100 });
    expect(none.status).toBe(400);
    expect((await none.json()).error).toBe(GROUP_GIFT_TARGET_REQUIRED);

    const res = await a.start(w.alice, { pledged: 100, target: { value: 5000, currency: 'eur' } });
    expect(res.status).toBe(201);
    expect((await liveGift(w.itemId))?.target).toEqual({ value: 5000, currency: 'EUR' });
  });

  it('refuses an unsupported currency, a zero or fractional pledge', async () => {
    expect(
      (await a.start(w.alice, { pledged: 100, target: { value: 5000, currency: 'XYZ' } })).status
    ).toBe(400);
    expect((await a.start(w.alice, { pledged: 0 })).status).toBe(400);
    expect((await a.start(w.alice, { pledged: 10.5 })).status).toBe(400);
    expect(await GroupGift.countDocuments()).toBe(0);
  });

  it('refuses an item that is already reserved, solo or as a group gift', async () => {
    await a.start(w.alice);
    const second = await a.start(w.bob);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe(GROUP_GIFT_NOT_AVAILABLE);
    expect(await GroupGift.countDocuments()).toBe(1);
  });

  it('answers a retried start with the same Idempotency-Key as the first, making one gift', async () => {
    const headers = { 'Idempotency-Key': 'start-key-0123456789' };
    expect((await a.start(w.alice, { pledged: 3000 }, headers)).status).toBe(201);
    const retry = await a.start(w.alice, { pledged: 3000 }, headers);
    expect(retry.status).toBe(201);
    expect((await retry.json()).data.groupGift.contributing).toBe(true);
    expect(await GroupGift.countDocuments()).toBe(1);
  });

  it('two members starting at once: exactly one gift, held by its organizer', async () => {
    const [x, y] = await Promise.all([a.start(w.alice), a.start(w.bob)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await GroupGift.countDocuments()).toBe(1);
    await expectEveryBookingReleasable(w.wishlistId);
  });
});

describe('group gift routes — who may call them', () => {
  const calls = [
    ['start', (u: string) => a.start(u)],
    ['pledge', (u: string) => a.pledge(u, 1000)],
    ['leave', (u: string) => a.leaveGift(u)],
    ['cancel', (u: string) => a.cancel(u)],
    ['convert', (u: string) => a.convert(u)],
    ['give', (u: string) => a.give(u)],
  ] as const;

  it.each(calls)(
    '%s: an owner gets the same answer whether or not a gift exists',
    async (_, call) => {
      const before = await call(w.owner);
      await a.start(w.alice);
      const after = await call(w.owner);
      expect(before.status).toBe(400);
      expect(after.status).toBe(400);
      expect(await before.json()).toEqual({ success: false, error: GROUP_GIFT_OWNER_ERROR });
      expect(await after.json()).toEqual({ success: false, error: GROUP_GIFT_OWNER_ERROR });
    }
  );

  it.each(calls)('%s: someone off the list is refused', async (_, call) => {
    await a.start(w.alice);
    expect((await call(w.dave)).status).toBe(403);
  });

  it.each(calls)('%s: signed out is refused', async (_, call) => {
    // Read first; the session the call queues itself is left unread.
    session.mockResolvedValueOnce(null as never);
    expect((await call(w.alice)).status).toBe(401);
  });

  it.each(calls)('%s: an archived list answers like a missing item', async (_, call) => {
    await a.start(w.alice);
    await Wishlist.updateOne({ _id: w.wishlistId }, { $set: { archived: true } });
    expect((await call(w.bob)).status).toBe(404);
  });

  it('a draft is answered like a missing item', async () => {
    await Item.updateOne({ _id: w.itemId }, { $set: { status: 'draft' } });
    expect((await a.start(w.alice)).status).toBe(404);
  });

  it.each([
    ['cancel', (u: string) => a.cancel(u)],
    ['convert', (u: string) => a.convert(u)],
    ['give', (u: string) => a.give(u)],
  ] as const)('%s: a contributor who is not the organizer is refused', async (_, call) => {
    await a.start(w.alice);
    await a.pledge(w.bob, 2000);
    const res = await call(w.bob);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(GROUP_GIFT_ORGANIZER_ONLY);
    expect((await liveGift(w.itemId))?.organizer.toString()).toBe(w.alice);
  });
});

describe('PUT/DELETE /api/items/[id]/group-gift/me — join, change pledge, leave', () => {
  it('joins with a pledge and a Reservation, turning funded at the target and back below it', async () => {
    await a.start(w.alice, { pledged: 3000 });
    const joined = await a.pledge(w.bob, 4000);
    expect(joined.status).toBe(200);
    expect((await joined.json()).data.groupGift).toMatchObject({
      contributing: true,
      organizer: false,
      status: 'open',
      percentFunded: 70,
    });
    expect(await reservationsOf()).toEqual([w.alice, w.bob].sort());

    await a.pledge(w.carol, 3000);
    expect((await liveGift(w.itemId))?.status).toBe('funded');

    const lowered = await a.pledge(w.bob, 1000);
    expect((await lowered.json()).data.groupGift).toMatchObject({
      status: 'open',
      pledgedTotal: 7000,
    });
    expect((await liveGift(w.itemId))?.status).toBe('open');
    // Changing a pledge adds no second place or Reservation.
    expect((await liveGift(w.itemId))?.contributors).toHaveLength(3);
    expect(await reservationsOf()).toEqual([w.alice, w.bob, w.carol].sort());
  });

  it('two members joining at once both get in', async () => {
    await a.start(w.alice);
    const [x, y] = await Promise.all([a.pledge(w.bob, 1000), a.pledge(w.carol, 1000)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect((await liveGift(w.itemId))?.contributors).toHaveLength(3);
  });

  it('has nothing to join on an item with no group gift, or one reserved solo', async () => {
    const res = await a.pledge(w.bob, 1000);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(GROUP_GIFT_NONE);
    await a.patchItem(w.alice, { status: 'booked' });
    expect((await a.pledge(w.bob, 1000)).status).toBe(409);
  });

  it('a contributor leaving loses their place and their Reservation', async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 2000);
    const res = await a.leaveGift(w.bob);
    expect(res.status).toBe(200);
    expect((await res.json()).data.groupGift).toEqual({ contributing: false, percentFunded: 30 });
    expect(await reservationsOf()).toEqual([w.alice]);
    expect((await liveGift(w.itemId))?.organizer.toString()).toBe(w.alice);
  });

  it('the organizer leaving hands it to the earliest remaining contributor, who then holds the item', async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 2000);
    await a.pledge(w.carol, 2000);
    expect((await a.leaveGift(w.alice)).status).toBe(200);

    const gift = await liveGift(w.itemId);
    expect(gift?.organizer.toString()).toBe(w.bob);
    expect((await itemNow())?.bookedBy?.toString()).toBe(w.bob);
    expect(await reservationsOf()).toEqual([w.bob, w.carol].sort());
    // Bob, the new organizer, can now cancel.
    expect((await a.cancel(w.bob)).status).toBe(200);
    expect((await itemNow())?.status).toBe('available');
  });

  it('the last contributor leaving ends the gift and releases the item', async () => {
    await a.start(w.alice);
    expect((await a.leaveGift(w.alice)).status).toBe(200);
    const item = await itemNow();
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(item?.groupGift).toBeUndefined();
    const gift = await GroupGift.findOne({ item: w.itemId }).lean();
    expect(gift?.active).toBeUndefined();
    expect(gift?.status).toBe('cancelled');
    expect(gift?.endedAs).toBe('emptied');
    expect(await reservationsOf()).toEqual([]);
    // And it can be started again.
    expect((await a.start(w.bob)).status).toBe(201);
  });
});

describe('organizer actions', () => {
  beforeEach(async () => {
    await a.start(w.alice, { pledged: 6000 });
    await a.pledge(w.bob, 4000);
  });

  it('cancel releases the item and deletes every contributor’s Reservation', async () => {
    const res = await a.cancel(w.alice);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('available');
    expect(body.data).not.toHaveProperty('groupGift');
    expect((await itemNow())?.groupGift).toBeUndefined();
    expect(await reservationsOf()).toEqual([]);
    expect((await GroupGift.findOne({ item: w.itemId }).lean())?.status).toBe('cancelled');
  });

  it('a retried cancel with the same Idempotency-Key answers as the first did', async () => {
    const headers = { 'Idempotency-Key': 'cancel-key-0123456789' };
    expect((await a.cancel(w.alice, headers)).status).toBe(200);
    expect((await a.cancel(w.alice, headers)).status).toBe(200);
    const again = await a.cancel(w.alice);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe(GROUP_GIFT_NONE);
  });

  it('convert leaves the organizer a normal booking, which they can then release', async () => {
    expect((await a.convert(w.alice)).status).toBe(200);
    const item = await itemNow();
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(w.alice);
    expect(item?.groupGift).toBeUndefined();
    expect(await reservationsOf()).toEqual([w.alice]);
    expect((await GroupGift.findOne({ item: w.itemId }).lean())?.endedAs).toBe('converted');

    const released = await a.patchItem(w.alice, { status: 'available' });
    expect(released.status).toBe(200);
    expect(await reservationsOf()).toEqual([]);
  });

  it('give writes one gift-history entry per contributor with their pledge, and leaves the item booked', async () => {
    const res = await a.give(w.alice);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'booked', givenByMe: true });

    const logs = await GiftLog.find({ item: w.itemId }).lean();
    expect(
      logs
        .map((l) => [l.gifter.toString(), l.itemPrice, l.itemName, l.recipient?.toString()])
        .sort()
    ).toEqual(
      [
        [w.alice, { value: 6000, currency: 'USD' }, 'Camera', w.owner],
        [w.bob, { value: 4000, currency: 'USD' }, 'Camera', w.owner],
      ].sort()
    );
    expect(await reservationsOf()).toEqual([]);
    const item = await itemNow();
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(w.alice);
    expect(item?.groupGift).toBeUndefined();
    expect((await GroupGift.findOne({ item: w.itemId }).lean())?.status).toBe('given');
  });

  it('give skips a contributor who already logged the item themselves', async () => {
    const mine = await Reservation.findOne({ gifter: w.bob, item: w.itemId }).lean();
    await GiftLog.create({
      gifter: w.bob,
      giftedAt: new Date(),
      itemName: 'Camera',
      item: w.itemId,
    });
    await Reservation.deleteOne({ _id: mine!._id });
    await a.give(w.alice);
    expect(await GiftLog.countDocuments({ gifter: w.bob, item: w.itemId })).toBe(1);
  });

  it('a plain unbook of the gift’s item is refused, for the organizer too', async () => {
    const res = await a.patchItem(w.alice, { status: 'available' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(GROUP_GIFT_UNBOOK_ERROR);
    expect((await itemNow())?.bookedBy?.toString()).toBe(w.alice);
    await expectEveryBookingReleasable(w.wishlistId);
  });

  // regression-style: a join and a cancel racing must leave no contributor with
  // a Reservation of an item the gift no longer holds.
  it('a join landing before a cancel is cancelled with it, Reservation included', async () => {
    const race = holdFirstCall(GroupGift, 'findOneAndUpdate', () => a.cancel(w.alice), {
      after: true,
    });
    const joined = await a.pledge(w.carol, 1000);
    expect(race.held()).toBe(true);
    expect(((await race.outcome()) as Response).status).toBe(200);
    expect(joined.status).toBe(409);
    expect((await joined.json()).error).toBe(GROUP_GIFT_ENDED);
    expect((await itemNow())?.status).toBe('available');
    expect(await reservationsOf()).toEqual([]);
  });

  it('a join landing after a cancel is refused and writes nothing', async () => {
    const race = holdFirstCall(GroupGift, 'findOneAndUpdate', () => a.cancel(w.alice));
    const joined = await a.pledge(w.carol, 1000);
    expect(race.held()).toBe(true);
    expect(joined.status).toBe(409);
    expect((await joined.json()).error).toBe(GROUP_GIFT_ENDED);
    expect((await itemNow())?.status).toBe('available');
    expect(await reservationsOf()).toEqual([]);
    const gift = await GroupGift.findOne({ item: w.itemId }).lean();
    expect(gift?.contributors.map((c) => c.user.toString())).toEqual([w.alice, w.bob]);
  });

  it('the organizer handing over mid-cancel: the cancel no longer matches', async () => {
    const race = holdFirstCall(GroupGift, 'findOneAndUpdate', () => a.leaveGift(w.alice));
    const cancelled = await a.cancel(w.alice);
    expect(race.held()).toBe(true);
    expect(cancelled.status).toBe(409);
    expect((await liveGift(w.itemId))?.organizer.toString()).toBe(w.bob);
    await expectEveryBookingReleasable(w.wishlistId);
  });
});

describe('owners and everyone off the list never see a group gift', () => {
  beforeEach(async () => {
    await a.start(w.alice, { pledged: 6000 });
    await a.pledge(w.bob, 4000);
  });

  it('the owner’s items read shows the item as plain available, no hint of the gift', async () => {
    const res = await a.readItems(w.owner);
    const [item] = (await res.json()).data;
    expect(item.status).toBe('available');
    expect(item).not.toHaveProperty('groupGift');
    expect(item).not.toHaveProperty('groupGiftRev');
    expect(item.bookedBy).toBeUndefined();
    const raw = await ownerVisibleJson();
    const gift = await liveGift(w.itemId);
    for (const leak of ['groupGift', 'percentFunded', gift!._id.toString(), w.alice, w.bob]) {
      expect(raw).not.toContain(leak);
    }
  });

  it('an owner’s edit answer is as blind as their read', async () => {
    const res = await a.patchItem(w.owner, { name: 'Camera kit' });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('groupGift');
    expect(raw).toContain('"status":"available"');
    // The gift goes on, untouched by a content edit.
    expect((await liveGift(w.itemId))?.contributors).toHaveLength(2);
  });

  it.each([
    ['signed out', null],
    ['signed in, off the list', 'dave'],
  ] as const)('a visitor (%s) gets nothing either', async (_, who) => {
    const res = await a.readItems(who ? w.dave : null);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('groupGift');
    expect(raw).toContain('"status":"available"');
  });

  it('a member not in it sees only how far it is funded', async () => {
    const [item] = (await (await a.readItems(w.carol)).json()).data;
    expect(item.status).toBe('booked');
    expect(item.groupGift).toEqual({ contributing: false, percentFunded: 100 });
    const raw = JSON.stringify(item);
    for (const leak of [w.alice, w.bob, 'alice', 'bob', 'pledged', 'contributors']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('a contributor sees names and pledges, never anyone else’s id', async () => {
    const [item] = (await (await a.readItems(w.bob)).json()).data;
    expect(item.groupGift).toMatchObject({
      contributing: true,
      organizer: false,
      status: 'funded',
      contributors: [
        { name: 'alice', pledged: 6000, organizer: true, you: false },
        { name: 'bob', pledged: 4000, organizer: false, you: true },
      ],
    });
    expect(JSON.stringify(item)).not.toContain(w.alice);
  });
});

describe('an owner’s change to the item ends its group gift', () => {
  beforeEach(async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 2000);
  });

  it.each(['draft', 'completed'] as const)(
    'moving it to %s ends the gift, keeps every Reservation, and a reopened item can be split again',
    async (status) => {
      expect((await a.patchItem(w.owner, { status })).status).toBe(200);
      const item = await itemNow();
      expect(item?.status).toBe(status);
      expect(item?.bookedBy).toBeNull();
      expect(item?.groupGift).toBeUndefined();
      const gift = await GroupGift.findOne({ item: w.itemId }).lean();
      expect(gift?.active).toBeUndefined();
      expect(gift?.endedAs).toBe('item-ended');
      expect(await reservationsOf()).toEqual([w.alice, w.bob].sort());

      await a.patchItem(w.owner, { status: 'available' });
      expect((await a.start(w.carol)).status).toBe(201);
    }
  );

  it('deleting it ends the gift and keeps every Reservation', async () => {
    expect((await a.deleteItem(w.owner)).status).toBe(200);
    expect((await GroupGift.findOne({ item: w.itemId }).lean())?.endedAs).toBe('item-ended');
    expect(await reservationsOf()).toEqual([w.alice, w.bob].sort());
  });

  it('deleting the list deletes its gifts and keeps every Reservation', async () => {
    as(w.owner);
    const res = await deleteWishlistRoute(json(`/api/wishlists/${w.wishlistId}`, 'DELETE'), {
      params: Promise.resolve({ id: w.wishlistId }),
    });
    expect(res.status).toBe(200);
    expect(await GroupGift.countDocuments()).toBe(0);
    expect(await reservationsOf()).toEqual([w.alice, w.bob].sort());
  });

  it('a gift whose ending failed is ended by the next start once it is stale', async () => {
    await a.patchItem(w.owner, { status: 'draft' });
    // As if the owner's follow-up had failed: the gift still live, its item not.
    // (On the raw collection: Mongoose won't write `createdAt`.)
    await GroupGift.collection.updateOne(
      { item: new mongoose.Types.ObjectId(w.itemId) },
      {
        $set: { active: true, status: 'open', createdAt: new Date(Date.now() - 120_000) },
        $unset: { endedAs: '' },
      }
    );
    await a.patchItem(w.owner, { status: 'available' });
    expect((await a.start(w.carol)).status).toBe(201);
    expect(await GroupGift.countDocuments({ item: w.itemId, active: true })).toBe(1);
    expect((await liveGift(w.itemId))?.organizer.toString()).toBe(w.carol);
  });
});
