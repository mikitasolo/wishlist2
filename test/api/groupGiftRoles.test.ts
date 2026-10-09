import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// WIS-361: "a group gift always has a holder who can release it". Every way off
// a list or into its owners (leaving, a kick, a promotion, account deletion)
// takes the person out of its group gifts, handing an organizer's role to the
// earliest remaining contributor, or ending the gift and releasing the item
// when nobody's left. And a start or join in flight across such a change is
// undone, as a solo booking is (`undoBookingUnlessMember`).

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: vi.fn().mockResolvedValue(undefined),
  list: (...args: unknown[]) => list(...args),
  put: vi.fn(),
  head: vi.fn(),
}));

import { DELETE as kickRoute } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as leaveRoute } from '@/app/api/wishlists/[id]/members/me/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import { __setRateLimiters } from '@/lib/rateLimit';
import Item from '@/models/Item';
import GroupGift from '@/models/GroupGift';
import Reservation from '@/models/Reservation';
import WishlistInvite from '@/models/WishlistInvite';
import {
  api,
  as,
  expectEveryBookingReleasable,
  json,
  liveGift,
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
  list.mockReset();
  list.mockResolvedValue({ blobs: [], cursor: undefined });
  __setRateLimiters(null);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', ['vercel', 'blob', 'rw', 'TestStore42', 'x'].join('_'));
  w = await seedWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Member = 'alice' | 'bob' | 'carol';

function kick(who: Member) {
  as(w.owner);
  const memberId = w.membership[who];
  return kickRoute(json(`/api/wishlists/${w.wishlistId}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: w.wishlistId, memberId }),
  });
}

function leaveList(who: Member) {
  as(w[who]);
  return leaveRoute(json(`/api/wishlists/${w.wishlistId}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: w.wishlistId }),
  });
}

async function promote(who: Member) {
  const invite = await WishlistInvite.create({
    wishlist: w.wishlistId,
    invitedBy: w.owner,
    invitedUser: w[who],
    role: 'owner',
    promotion: true,
  });
  const inviteId = invite._id.toString();
  as(w[who]);
  return respondInvite(json(`/api/invites/${inviteId}`, 'PATCH', { action: 'accept' }), {
    params: Promise.resolve({ inviteId }),
  });
}

async function deleteAccountOf(who: Member) {
  return deleteAccount(w[who], { agreedListIds: [] });
}

const removals = [
  ['leaves the list', (who: Member) => leaveList(who)],
  ['is kicked', (who: Member) => kick(who)],
  ['is made an owner', (who: Member) => promote(who)],
  ['deletes their account', (who: Member) => deleteAccountOf(who)],
] as const;

const itemNow = () => Item.findById(w.itemId).lean();
const reservationOf = (who: string) => Reservation.exists({ gifter: who, item: w.itemId });

describe('the organizer going hands the gift to the earliest remaining contributor', () => {
  it.each(removals)(
    'regression: an organizer who %s leaves bob holding the gift and the item',
    async (_, removal) => {
      await a.start(w.alice, { pledged: 3000 });
      await a.pledge(w.bob, 2000);
      await a.pledge(w.carol, 1000);

      await removal('alice');

      const gift = await liveGift(w.itemId);
      expect(gift?.organizer.toString()).toBe(w.bob);
      expect(gift?.contributors.map((c) => c.user.toString())).toEqual([w.bob, w.carol]);
      expect((await itemNow())?.bookedBy?.toString()).toBe(w.bob);
      await expectEveryBookingReleasable(w.wishlistId);

      // Bob can release it: the gift has a holder who can.
      expect((await a.cancel(w.bob)).status).toBe(200);
      expect((await itemNow())?.status).toBe('available');
    }
  );

  it.each(removals)(
    'regression: a sole organizer who %s ends the gift and releases the item',
    async (_, removal) => {
      await a.start(w.alice);
      await removal('alice');
      const item = await itemNow();
      expect(item?.status).toBe('available');
      expect(item?.bookedBy).toBeNull();
      expect(item?.groupGift).toBeUndefined();
      expect(await liveGift(w.itemId)).toBeNull();
      await expectEveryBookingReleasable(w.wishlistId);
    }
  );

  it.each(removals)(
    'a contributor who %s is taken out; the organizer keeps it',
    async (_, removal) => {
      await a.start(w.alice, { pledged: 3000 });
      await a.pledge(w.bob, 7000);
      expect((await liveGift(w.itemId))?.status).toBe('funded');

      await removal('bob');

      const gift = await liveGift(w.itemId);
      expect(gift?.organizer.toString()).toBe(w.alice);
      expect(gift?.contributors.map((c) => c.user.toString())).toEqual([w.alice]);
      expect(gift?.status).toBe('open');
      await expectEveryBookingReleasable(w.wishlistId);
    }
  );
});

describe('Reservations on the way out', () => {
  it('leaving the list or a kick keeps the contributor’s Reservation, as for a booking', async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 1000);
    await a.pledge(w.carol, 1000);
    await leaveList('bob');
    await kick('carol');
    expect(await reservationOf(w.bob)).toBeTruthy();
    expect(await reservationOf(w.carol)).toBeTruthy();
  });

  it('becoming an owner deletes their Reservation: an owner is never their own gifter', async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 1000);
    const res = await promote('alice');
    expect(res.status).toBe(200);
    expect(await reservationOf(w.alice)).toBeNull();
    expect(await reservationOf(w.bob)).toBeTruthy();
    // And as an owner now, she reads the item as plain available.
    const raw = JSON.stringify(await (await a.readItems(w.alice)).json());
    expect(raw).not.toContain('groupGift');
    expect(raw).toContain('"status":"available"');
  });

  it('account deletion leaves no trace of the person in any gift', async () => {
    await a.start(w.alice);
    await a.pledge(w.bob, 1000);
    await a.cancel(w.alice); // a finished gift she organized
    await a.start(w.bob);
    await a.pledge(w.alice, 1000); // a live one she's in
    await deleteAccountOf('alice');
    const mentioning = await GroupGift.countDocuments({
      $or: [{ organizer: w.alice }, { 'contributors.user': w.alice }],
    });
    expect(mentioning).toBe(0);
    expect((await liveGift(w.itemId))?.organizer.toString()).toBe(w.bob);
  });
});

describe('a start or join in flight across a role change is undone', () => {
  // regression-style: as `undoBookingUnlessMember` for a solo booking. Without
  // the re-check, a start whose item write lands after the promotion's release
  // would leave an owner organizing a gift on their own list: booking-blind,
  // they could never release it.
  it('a start whose item write lands after a promotion is undone, with the owner’s answer', async () => {
    const race = holdFirstCall(Item, 'findOneAndUpdate', () => promote('alice'));
    const started = await a.start(w.alice);
    expect(race.held()).toBe(true);
    expect(((await race.outcome()) as Response).status).toBe(200);
    expect(started.status).toBe(400);
    const item = await itemNow();
    expect(item?.status).toBe('available');
    expect(item?.groupGift).toBeUndefined();
    expect(await liveGift(w.itemId)).toBeNull();
    expect(await reservationOf(w.alice)).toBeNull();
  });

  it.each([
    ['is kicked', () => kick('bob')],
    ['leaves the list', () => leaveList('bob')],
  ])('a join whose write lands after its member %s is undone, with a 403', async (_, removal) => {
    await a.start(w.alice);
    const race = holdFirstCall(GroupGift, 'findOneAndUpdate', removal);
    const joined = await a.pledge(w.bob, 1000);
    expect(race.held()).toBe(true);
    expect(joined.status).toBe(403);
    const gift = await liveGift(w.itemId);
    expect(gift?.contributors.map((c) => c.user.toString())).toEqual([w.alice]);
    expect(await reservationOf(w.bob)).toBeNull();
    await expectEveryBookingReleasable(w.wishlistId);
  });

  // regression: the undo deleted the Reservation the start had overwritten,
  // where `undoBookingUnlessMember` puts it back: a member kicked mid-start lost
  // the Reservation an owner's change had kept for them from an earlier booking.
  it('a start undone by a kick puts back the Reservation it replaced', async () => {
    await a.patchItem(w.alice, { status: 'booked' });
    await a.patchItem(w.owner, { status: 'completed' });
    await a.patchItem(w.owner, { status: 'available' });
    await Reservation.updateOne({ gifter: w.alice, item: w.itemId }, { itemName: 'Old camera' });

    const race = holdFirstCall(Item, 'findOneAndUpdate', () => kick('alice'));
    const started = await a.start(w.alice);
    expect(race.held()).toBe(true);
    expect(started.status).toBe(403);
    expect((await itemNow())?.status).toBe('available');
    const kept = await Reservation.findOne({ gifter: w.alice, item: w.itemId }).lean();
    expect(kept?.itemName).toBe('Old camera');
  });

  it('a join whose write lands just before a promotion is taken out by it', async () => {
    await a.start(w.alice);
    const race = holdFirstCall(GroupGift, 'findOneAndUpdate', () => promote('bob'), {
      after: true,
    });
    const joined = await a.pledge(w.bob, 1000);
    expect(race.held()).toBe(true);
    expect(joined.status).toBe(400);
    expect((await liveGift(w.itemId))?.contributors).toHaveLength(1);
    expect(await reservationOf(w.bob)).toBeNull();
    await expectEveryBookingReleasable(w.wishlistId);
  });
});
