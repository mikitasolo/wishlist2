import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// WIS-364: group gift notifications go to the gift's contributors only: never
// an owner (one who used to contribute included), never a member who isn't in
// it, never whoever did it; re-checked at send and when the feed is read.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: vi.fn(),
  sendWishlistInvitationEmail: vi.fn(),
}));
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
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ blobs: [], cursor: undefined }),
  put: vi.fn(),
  head: vi.fn(),
}));

import { sendNotificationEmail } from '@/lib/email';
import { DELETE as kickRoute } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { GET as feedRoute } from '@/app/api/notifications/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { createNotifications } from '@/lib/notifications';
import { claimGroupGiftJoinEmail } from '@/lib/notificationEmails';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import GroupGift from '@/models/GroupGift';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import { api, as, json, liveGift, seedWorld, session, type World } from './groupGiftHarness';

const sendEmail = vi.mocked(sendNotificationEmail);

let w: World;
const a = api(() => w);

beforeAll(async () => {
  await connectTestDB();
  await NotificationEmailClaim.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  __setRateLimiters(null);
  w = await seedWorld();
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

type Member = 'alice' | 'bob' | 'carol';
const name = (id: string) =>
  (Object.entries(w).find(([, v]) => v === id)?.[0] ?? id) as Member | 'owner' | 'dave';

/** Every group gift row, as "<recipient> <type>", sorted. */
async function rows(): Promise<string[]> {
  const all = await Notification.find({ type: /^group_gift_/ }).lean();
  return all.map((n) => `${name(String(n.user))} ${n.type}`).sort();
}

/** Who was emailed (by recipient name) about which type, sorted. */
const emailed = () =>
  sendEmail.mock.calls.map(([, d]) => `${name(d.recipientId)} ${d.type}`).sort();

async function clearRecords() {
  await Notification.deleteMany({});
  sendEmail.mockClear();
}

function kick(who: Member) {
  as(w.owner);
  const memberId = w.membership[who];
  return kickRoute(json(`/api/wishlists/${w.wishlistId}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: w.wishlistId, memberId }),
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

async function feed(who: string) {
  as(who);
  const body = await (await feedRoute(json('/api/notifications', 'GET'))).json();
  return body as { data: { type: string }[]; unreadCount: number };
}

/** Alice starts ($30 of $100), bob joins ($30): the gift's two contributors. */
async function aliceAndBob() {
  expect((await a.start(w.alice, { pledged: 3000 })).status).toBe(201);
  expect((await a.pledge(w.bob, 3000)).status).toBe(200);
  await clearRecords();
}

describe('someone joins', () => {
  it('tells the others in it, by name; not the joiner, an owner, or a member not in it', async () => {
    await aliceAndBob();
    expect((await a.pledge(w.carol, 1000)).status).toBe(200);

    expect(await rows()).toEqual(['alice group_gift_joined', 'bob group_gift_joined']);
    const row = await Notification.findOne({ user: w.alice }).lean();
    expect(row).toMatchObject({
      actorUsername: 'carol',
      wishlistName: 'Birthday',
      itemName: 'Camera',
    });
    expect(String(row!.actor)).toBe(w.carol);
    // Off by email unless turned on.
    expect(emailed()).toEqual([]);
  });

  it('the starter is told of nobody, and a pledge change tells nobody it joined', async () => {
    expect((await a.start(w.alice, { pledged: 3000 })).status).toBe(201);
    expect(await rows()).toEqual([]);
    await a.pledge(w.bob, 1000);
    await clearRecords();
    expect((await a.pledge(w.bob, 2000)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it('emails at most once a day per gift per contributor, when turned on', async () => {
    await User.updateOne(
      { _id: w.alice },
      { $set: { 'notificationPrefs.group_gift_joined.email': true } }
    );
    expect((await a.start(w.alice, { pledged: 1000 })).status).toBe(201);
    await a.pledge(w.bob, 1000);
    await a.pledge(w.carol, 1000);
    // Two joins, two rows, one email.
    expect(await rows()).toEqual([
      'alice group_gift_joined',
      'alice group_gift_joined',
      'bob group_gift_joined',
    ]);
    expect(emailed()).toEqual(['alice group_gift_joined']);
    const [, details] = sendEmail.mock.calls[0]!;
    expect(details.actorUsername).toBe('bob');
  });

  it('the join claim is per gift and per contributor, and lets one of two racers through', async () => {
    const gift = '64b7f0c2a1b2c3d4e5f60711';
    const other = '64b7f0c2a1b2c3d4e5f60712';
    const [first, second] = await Promise.all([
      claimGroupGiftJoinEmail(w.alice, w.wishlistId, gift),
      claimGroupGiftJoinEmail(w.alice, w.wishlistId, gift),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await claimGroupGiftJoinEmail(w.alice, w.wishlistId, other)).not.toBeNull();
    expect(await claimGroupGiftJoinEmail(w.bob, w.wishlistId, gift)).not.toBeNull();
    // A day later, the gift's next join emails again.
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    expect(await claimGroupGiftJoinEmail(w.alice, w.wishlistId, gift, later)).not.toBeNull();
  });
});

describe('the target is met', () => {
  it('tells everyone in it but whoever met it, once', async () => {
    await aliceAndBob();
    expect((await a.pledge(w.carol, 4000)).status).toBe(200);
    expect(await rows()).toEqual([
      'alice group_gift_funded',
      'alice group_gift_joined',
      'bob group_gift_funded',
      'bob group_gift_joined',
    ]);
    // On by email.
    expect(emailed()).toEqual(['alice group_gift_funded', 'bob group_gift_funded']);

    // Dropping under the target and back tells nobody again.
    await clearRecords();
    await a.pledge(w.carol, 1000);
    await a.pledge(w.carol, 4000);
    expect(await rows()).toEqual([]);
  });

  it('by a pledge change, the changer is not told', async () => {
    await aliceAndBob();
    expect((await a.pledge(w.bob, 7000)).status).toBe(200);
    expect(await rows()).toEqual(['alice group_gift_funded']);
  });

  it('a gift funded from the start tells nobody, then or later', async () => {
    expect((await a.start(w.alice, { pledged: 10000 })).status).toBe(201);
    await a.pledge(w.bob, 1000);
    expect(await rows()).toEqual(['alice group_gift_joined']);
  });
});

describe('the organizer role passes on', () => {
  it('a leave tells the new organizer only, naming nobody', async () => {
    await aliceAndBob();
    await a.pledge(w.carol, 1000);
    await clearRecords();
    expect((await a.leaveGift(w.alice)).status).toBe(200);
    expect(await rows()).toEqual(['bob group_gift_organizer']);
    const row = await Notification.findOne({ user: w.bob }).lean();
    expect(row!.actorUsername).toBeNull();
    expect(row!.actor).toBeUndefined();
    expect(emailed()).toEqual(['bob group_gift_organizer']);
  });

  it('a contributor leaving who isn’t the organizer tells nobody', async () => {
    await aliceAndBob();
    expect((await a.leaveGift(w.bob)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it('regression: a kick tells the new organizer without naming the owner who did it', async () => {
    await aliceAndBob();
    expect((await kick('alice')).status).toBe(200);
    expect(await rows()).toEqual(['bob group_gift_organizer']);
    const row = await Notification.findOne({ user: w.bob, type: 'group_gift_organizer' }).lean();
    expect(row!.actorUsername).toBeNull();
    expect(JSON.stringify(row)).not.toContain(w.owner);
    const [, details] = sendEmail.mock.calls.find(([, d]) => d.type === 'group_gift_organizer')!;
    expect(details.actorUsername ?? null).toBeNull();
  });

  it('the organizer made an owner: the new organizer is told, the new owner never', async () => {
    await aliceAndBob();
    expect((await promote('alice')).status).toBe(200);
    expect(await rows()).toEqual(['bob group_gift_organizer']);
    expect(emailed()).toEqual(['bob group_gift_organizer']);
  });
});

describe('the organizer ends it', () => {
  it.each([
    ['cancel', 'group_gift_cancelled', true],
    ['convert', 'group_gift_converted', true],
    ['give', 'group_gift_given', false],
  ] as const)('%s tells the others who were in it', async (action, type, byEmail) => {
    await aliceAndBob();
    await a.pledge(w.carol, 1000);
    await clearRecords();
    expect((await a[action](w.alice)).status).toBe(200);
    expect(await rows()).toEqual([`bob ${type}`, `carol ${type}`]);
    expect(emailed()).toEqual(byEmail ? [`bob ${type}`, `carol ${type}`] : []);
    for (const n of await Notification.find({ type }).lean()) {
      expect(n.actorUsername).toBeNull();
    }
  });

  it('an owner never hears of it, nor of anything before', async () => {
    await aliceAndBob();
    await a.pledge(w.carol, 9000);
    await a.leaveGift(w.alice);
    await a.cancel(w.bob);
    expect(await Notification.countDocuments({ user: w.owner })).toBe(0);
    expect(sendEmail.mock.calls.some(([, d]) => d.recipientId === w.owner)).toBe(false);
    expect(await Notification.countDocuments({ user: w.dave })).toBe(0);
  });

  it('nothing to a contributor taken off the list meanwhile, or made an owner', async () => {
    await aliceAndBob();
    await a.pledge(w.carol, 1000);
    // Both changes landing without the gift catching up (a race with the
    // role change's own withdrawal): the send-time check still holds.
    await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.bob } });
    await WishlistMember.deleteOne({ wishlist: w.wishlistId, user: w.bob });
    await WishlistMember.deleteOne({ wishlist: w.wishlistId, user: w.carol });
    await clearRecords();
    expect((await a.cancel(w.alice)).status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(emailed()).toEqual([]);
  });

  it('nothing on an archived list', async () => {
    await aliceAndBob();
    // Archived after the gift's write landed: members can no longer open it.
    const gift = await liveGift(w.itemId);
    await Wishlist.updateOne({ _id: w.wishlistId }, { $set: { archived: true } });
    const { endGroupGift } = await import('@/lib/utils/groupGifts');
    const ended = await endGroupGift(gift!._id, w.alice, 'cancelled');
    const { notifyGroupGiftEnded } = await import('@/lib/groupGiftNotifications');
    await notifyGroupGiftEnded(ended!, 'cancelled');
    expect(await rows()).toEqual([]);
  });

  it('regression: a recipient made an owner after the send-time check gets no row and no email', async () => {
    await aliceAndBob();
    // Bob is promoted the moment the rows are written: the re-check after the
    // write takes his row back, and no email goes out.
    const race = holdFirstCall(Notification, 'create', async () => {
      await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.bob } });
      await WishlistMember.deleteOne({ wishlist: w.wishlistId, user: w.bob });
    });
    expect((await a.cancel(w.alice)).status).toBe(200);
    expect(race.held()).toBe(true);
    expect(await rows()).toEqual([]);
    expect(emailed()).toEqual([]);
  });
});

describe('the feed re-checks', () => {
  it('regression: an ex-contributor made an owner no longer sees or counts their group gift rows', async () => {
    await aliceAndBob();
    await a.pledge(w.carol, 1000); // alice and bob are told carol joined
    expect((await feed(w.bob)).unreadCount).toBe(1);

    expect((await promote('bob')).status).toBe(200);
    const after = await feed(w.bob);
    expect(after.data.filter((n) => n.type.startsWith('group_gift_'))).toEqual([]);
    expect(after.unreadCount).toBe(0);
    // The rows stay: alice, still a member, sees hers.
    const alice = await feed(w.alice);
    expect(alice.data.map((n) => n.type)).toContain('group_gift_joined');
    expect(alice.unreadCount).toBeGreaterThan(0);
  });

  it('a kicked contributor no longer sees them either', async () => {
    await aliceAndBob();
    await a.pledge(w.carol, 1000);
    expect((await kick('bob')).status).toBe(200);
    const bob = await feed(w.bob);
    expect(bob.data.filter((n) => n.type.startsWith('group_gift_'))).toEqual([]);
  });
});

describe('createNotifications’ re-check after the write', () => {
  it('takes back the rows of whoever no longer qualifies, and emails only the rest', async () => {
    const ids = await createNotifications(
      [w.alice, w.bob],
      { type: 'group_gift_cancelled', wishlist: w.wishlistId, wishlistName: 'Birthday' },
      { recheck: async (users) => users.filter((u) => u === w.alice) }
    );
    expect(ids).toHaveLength(1);
    expect(await rows()).toEqual(['alice group_gift_cancelled']);
    expect(emailed()).toEqual(['alice group_gift_cancelled']);
  });

  it('keeps nobody when the re-check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await createNotifications(
      [w.alice],
      { type: 'group_gift_cancelled', wishlist: w.wishlistId, wishlistName: 'Birthday' },
      {
        recheck: async () => {
          throw new Error('down');
        },
      }
    );
    expect(await rows()).toEqual([]);
    expect(emailed()).toEqual([]);
  });
});

describe('email limits', () => {
  it('a limited recipient is not emailed, and keeps the row', async () => {
    const limit = vi.fn<RateLimiter['limit']>();
    limit.mockResolvedValue({ success: false, reset: Date.now() + 60_000, limit: 1, remaining: 0 });
    __setRateLimiters({ emailGroupGift: { limit } });
    await aliceAndBob();
    __setRateLimiters({ emailGroupGift: { limit } });
    await a.cancel(w.alice);
    expect(limit).toHaveBeenCalledWith(w.bob);
    expect(emailed()).toEqual([]);
    expect(await rows()).toEqual(['bob group_gift_cancelled']);
  });
});

it('the funded claim is taken once, whatever races', async () => {
  await aliceAndBob();
  const gift = await liveGift(w.itemId);
  await GroupGift.updateOne({ _id: gift!._id }, { $set: { status: 'funded' } });
  const { notifyGroupGiftFunded } = await import('@/lib/groupGiftNotifications');
  await Promise.all([
    notifyGroupGiftFunded(gift!._id, w.carol),
    notifyGroupGiftFunded(gift!._id, w.carol),
  ]);
  expect(await rows()).toEqual(['alice group_gift_funded', 'bob group_gift_funded']);
});
