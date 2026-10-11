import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Reminders about what you've reserved (WIS-384): a week before a list's
// occasion, and three days after it for what isn't marked as given, only to
// whoever holds a reservation or a group gift pledge there as a plain member,
// once per person, list and occurrence, re-checked after the write, before
// each email and on every feed read. Owners never get one.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn() }));
// The real claim, which a test can make run something first: a change landing
// between the run's read and its email.
vi.mock('@/lib/notificationEmails', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/notificationEmails')>();
  return { ...real, claimOccurrenceEmail: vi.fn(real.claimOccurrenceEmail) };
});

import { auth } from '@/lib/auth';
import { sendNotificationEmail } from '@/lib/email';
import { claimOccurrenceEmail } from '@/lib/notificationEmails';
import { GET as CRON } from '@/app/api/cron/gift-reminders/route';
import { GET as FEED } from '@/app/api/notifications/route';
import {
  createGiftReminders,
  giftReminderOffsets,
  sendGiftReminders,
} from '@/lib/utils/giftReminders';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GroupGift from '@/models/GroupGift';
import type { Occasion } from '@/lib/utils/occasion';

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendNotificationEmail);
const claim = vi.mocked(claimOccurrenceEmail);

// Monday 5 Oct 2026, 06:30 UTC: a week ahead is Monday 12 Oct, three days
// back Friday 2 Oct.
const NOW = new Date('2026-10-05T06:30:00Z');
const IN_A_WEEK = '2026-10-12';
const THREE_DAYS_AGO = '2026-10-02';

let owner: Types.ObjectId;
let seq = 0;

beforeAll(async () => {
  await connectTestDB();
  await Promise.all([Notification.init(), NotificationEmailClaim.init()]);
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  owner = (await User.create({ email: 'owner@x.com', username: 'owner' }))._id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function user(name: string, extra: Record<string, unknown> = {}) {
  return (await User.create({ email: `${name}@x.com`, username: name, ...extra }))._id;
}

async function list(occasion: Occasion | null, extra: Record<string, unknown> = {}) {
  seq += 1;
  return Wishlist.create({
    name: `List ${seq}`,
    slug: `list-${seq}`,
    owners: [owner],
    visibility: 'friends',
    occasion,
    ...extra,
  });
}

const join = (wishlist: Types.ObjectId, member: Types.ObjectId) =>
  WishlistMember.create({ wishlist, user: member });

/** A solo booking: the item booked by `gifter`, and their Reservation. */
async function reserve(
  wishlist: Types.ObjectId,
  gifter: Types.ObjectId,
  extra: { createdAt?: Date } = {}
) {
  const item = await Item.create({
    name: 'Lego set',
    wishlist,
    status: 'booked',
    bookedBy: gifter,
  });
  const reservation = await Reservation.create({
    gifter,
    wishlist,
    item: item._id,
    owner,
    itemName: 'Lego set',
    wishlistName: 'List',
    ...extra,
  });
  return { item, reservation };
}

/** A live group gift organized by `organizer`, with every contributor's Reservation. */
async function groupGift(wishlist: Types.ObjectId, contributors: Types.ObjectId[]) {
  const item = await Item.create({
    name: 'Camera',
    wishlist,
    status: 'booked',
    bookedBy: contributors[0],
  });
  const gift = await GroupGift.create({
    item: item._id,
    wishlist,
    organizer: contributors[0],
    target: { value: 10000, currency: 'USD' },
    contributors: contributors.map((u) => ({ user: u, pledged: 1000, joinedAt: new Date() })),
    status: 'open',
    active: true,
  });
  await Item.updateOne({ _id: item._id }, { $set: { groupGift: gift._id } });
  for (const u of contributors) {
    await Reservation.create({
      gifter: u,
      wishlist,
      item: item._id,
      owner,
      itemName: 'Camera',
      wishlistName: 'List',
      pledge: { value: 1000, currency: 'USD' },
    });
  }
  return { item, gift };
}

const rows = (type: 'gift_reminder' | 'gift_nudge', filter: Record<string, unknown> = {}) =>
  Notification.find({ type, ...filter }).lean();

const recipients = async (type: 'gift_reminder' | 'gift_nudge') =>
  (await rows(type)).map((n) => String(n.user)).sort();

const cron = (token?: string) =>
  CRON(
    new NextRequest('http://localhost/api/cron/gift-reminders', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

async function feedAs(id: Types.ObjectId) {
  session.mockResolvedValue({ user: { id: String(id) } } as never);
  const res = await FEED(new NextRequest('http://localhost/api/notifications'));
  return (await res.json()) as {
    data: Array<Record<string, unknown>>;
    unreadCount: number;
  };
}

const birthdayIn = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: null });

describe('GET /api/cron/gift-reminders', () => {
  it('500s without CRON_SECRET and 401s a wrong or missing token, sending nothing', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    await join(l._id, mia);
    await reserve(l._id, mia);

    expect((await cron()).status).toBe(401);
    expect((await cron('wrong')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await cron('cron-secret')).status).toBe(500);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('runs with the right token and answers counts only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    await join(l._id, mia);
    await reserve(l._id, mia);

    const res = await cron('cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      reminders: { lists: 1, sent: 1, capped: false },
      nudges: { lists: 0, sent: 0, capped: false },
      emailed: 0,
      // WIS-443: the same run settles dead item moves first (none here).
      deadMoves: { settled: 0, failed: 0, capped: false },
    });
  });
});

describe('giftReminderOffsets', () => {
  it('is a week ahead (catching up two days) and three days after (two more)', () => {
    expect(giftReminderOffsets('gift_reminder')).toEqual([7, 6, 5]);
    expect(giftReminderOffsets('gift_nudge')).toEqual([-3, -4, -5]);
  });
});

describe('sendGiftReminders: before the occasion', () => {
  it('reminds only those holding something: never the owner or other members', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const holder = await user('holder');
    const idle = await user('idle');
    await join(l._id, holder);
    await join(l._id, idle);
    await reserve(l._id, holder);
    // An owner with a stray member row and a reservation row is still an owner.
    await join(l._id, owner);
    await Reservation.create({
      gifter: owner,
      wishlist: l._id,
      item: (await Item.create({ name: 'x', wishlist: l._id, status: 'booked', bookedBy: owner }))
        ._id,
      owner,
      itemName: 'x',
      wishlistName: 'List',
    });

    const run = await sendGiftReminders(NOW);
    expect(run.reminders).toEqual({ lists: 1, sent: 1, capped: false });
    expect(await recipients('gift_reminder')).toEqual([String(holder)]);
  });

  it('reminds every contributor of a live group gift, organizer included', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const org = await user('org');
    const pal = await user('pal');
    await join(l._id, org);
    await join(l._id, pal);
    await groupGift(l._id, [org, pal]);

    await sendGiftReminders(NOW);
    expect(await recipients('gift_reminder')).toEqual([String(org), String(pal)].sort());
  });

  it('skips a contributor who left the gift, and everyone once it ended', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const org = await user('org');
    const gone = await user('gone');
    await join(l._id, org);
    await join(l._id, gone);
    const { gift } = await groupGift(l._id, [org, gone]);
    // Left the gift: their Reservation stays, but they're no longer in it.
    await GroupGift.updateOne({ _id: gift._id }, { $pull: { contributors: { user: gone } } });

    await sendGiftReminders(NOW);
    expect(await recipients('gift_reminder')).toEqual([String(org)]);

    const later = await list(birthdayIn(IN_A_WEEK));
    const a = await user('a');
    await join(later._id, a);
    const ended = await groupGift(later._id, [a]);
    await GroupGift.updateOne(
      { _id: ended.gift._id },
      { $unset: { active: 1 }, $set: { status: 'cancelled' } }
    );
    await sendGiftReminders(NOW);
    expect(await rows('gift_reminder', { wishlist: later._id })).toHaveLength(0);
  });

  it('skips a kept reservation that no longer holds the item (released, received, or someone else’s now)', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const [a, b, c] = [await user('a'), await user('b'), await user('c')];
    for (const u of [a, b, c]) await join(l._id, u);
    const ra = await reserve(l._id, a);
    const rb = await reserve(l._id, b);
    const rc = await reserve(l._id, c);
    // An owner marked it received: bookedBy cleared, Reservation kept.
    await Item.updateOne({ _id: ra.item._id }, { $set: { status: 'completed', bookedBy: null } });
    // An owner moved it to draft.
    await Item.updateOne({ _id: rb.item._id }, { $set: { status: 'draft', bookedBy: null } });
    // Deleted.
    await Item.deleteOne({ _id: rc.item._id });

    await sendGiftReminders(NOW);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('skips someone who left or was kicked (their Reservation kept), and an archived list', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const kicked = await user('kicked');
    await reserve(l._id, kicked);
    // No membership: they left or were kicked after reserving.
    const archived = await list(birthdayIn(IN_A_WEEK), { archived: true });
    const m = await user('m');
    await join(archived._id, m);
    await reserve(archived._id, m);

    await sendGiftReminders(NOW);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('skips anyone who turned it off in app', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const off = await user('off', { notificationPrefs: { gift_reminder: { inApp: false } } });
    await join(l._id, off);
    await reserve(l._id, off);

    await sendGiftReminders(NOW);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('says the list, the occasion’s kind and day: no item, no count, no actor', async () => {
    const l = await list({ kind: 'wedding', date: IN_A_WEEK, recurrence: null });
    const mia = await user('mia');
    await join(l._id, mia);
    await reserve(l._id, mia);
    await reserve(l._id, mia);

    await sendGiftReminders(NOW);
    const [row] = await rows('gift_reminder');
    expect(row).toMatchObject({
      user: mia,
      wishlist: l._id,
      wishlistName: l.name,
      occasionKind: 'wedding',
      occasionDate: IN_A_WEEK,
      itemName: null,
      actorUsername: null,
      count: 1,
      read: false,
    });
    expect(row.actor).toBeUndefined();
  });

  it('reminds about a yearly occasion’s next occurrence, catching up two days late, never earlier or later', async () => {
    const yearly = await list({ kind: 'birthday', date: '2000-10-10', recurrence: 'yearly' });
    const tooEarly = await list(birthdayIn('2026-10-13'));
    const tooLate = await list(birthdayIn('2026-10-09'));
    const mia = await user('mia');
    for (const l of [yearly, tooEarly, tooLate]) {
      await join(l._id, mia);
      await reserve(l._id, mia);
    }

    await sendGiftReminders(NOW);
    const all = await rows('gift_reminder');
    expect(all.map((r) => [String(r.wishlist), r.occasionDate])).toEqual([
      [String(yearly._id), '2026-10-10'],
    ]);
  });
});

describe('sendGiftReminders: after the occasion', () => {
  it('nudges a holder three days after, about what is still not marked as given', async () => {
    const l = await list(birthdayIn(THREE_DAYS_AGO));
    const holds = await user('holds');
    const gave = await user('gave');
    await join(l._id, holds);
    await join(l._id, gave);
    await reserve(l._id, holds, { createdAt: new Date('2026-09-20T10:00:00Z') });
    // Marked as given: the Reservation ends, the item stays booked by them.
    const given = await reserve(l._id, gave, { createdAt: new Date('2026-09-20T10:00:00Z') });
    await Reservation.deleteOne({ _id: given.reservation._id });

    const run = await sendGiftReminders(NOW);
    expect(run.nudges).toEqual({ lists: 1, sent: 1, capped: false });
    expect(await recipients('gift_nudge')).toEqual([String(holds)]);
    expect(await rows('gift_reminder')).toHaveLength(0);
    const [row] = await rows('gift_nudge');
    expect(row.occasionDate).toBe(THREE_DAYS_AGO);
  });

  it('ignores a reservation made after the occasion’s day, and an occasion only two days ago', async () => {
    const past = await list(birthdayIn(THREE_DAYS_AGO));
    const recent = await list(birthdayIn('2026-10-03'));
    const mia = await user('mia');
    await join(past._id, mia);
    await join(recent._id, mia);
    await reserve(past._id, mia, { createdAt: new Date('2026-10-03T00:00:00Z') });
    await reserve(recent._id, mia, { createdAt: new Date('2026-09-01T00:00:00Z') });

    await sendGiftReminders(NOW);
    expect(await rows('gift_nudge')).toHaveLength(0);
  });

  // regression: only a group gift's organizer can mark it as given (the others
  // get a 409), so only they are nudged; every contributor is reminded before.
  it('nudges a live group gift’s organizer only, not its other contributors', async () => {
    const l = await list(birthdayIn(THREE_DAYS_AGO));
    const org = await user('org');
    const pal = await user('pal');
    await join(l._id, org);
    await join(l._id, pal);
    await groupGift(l._id, [org, pal]);
    // The model's timestamps keep createdAt out of an update: write it directly.
    await Reservation.collection.updateMany(
      {},
      { $set: { createdAt: new Date('2026-09-01T00:00:00Z') } }
    );

    await sendGiftReminders(NOW);
    expect(await recipients('gift_nudge')).toEqual([String(org)]);
  });

  // regression: an owner marking it received doesn't mark it as given for the
  // gifter, whose Reservation is still there to settle.
  it('nudges a holder whose item the owner already marked received, but never reminds before', async () => {
    const past = await list(birthdayIn(THREE_DAYS_AGO));
    const coming = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    for (const l of [past, coming]) {
      await join(l._id, mia);
      const { item } = await reserve(l._id, mia, {
        createdAt: new Date('2026-09-01T00:00:00Z'),
      });
      await Item.updateOne({ _id: item._id }, { $set: { status: 'completed', bookedBy: null } });
    }

    await sendGiftReminders(NOW);
    expect(await recipients('gift_nudge')).toEqual([String(mia)]);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('nudges about a yearly occasion that just passed', async () => {
    const l = await list({ kind: 'holiday', date: '2000-10-02', recurrence: 'yearly' });
    const mia = await user('mia');
    await join(l._id, mia);
    await reserve(l._id, mia, { createdAt: new Date('2026-09-01T00:00:00Z') });

    await sendGiftReminders(NOW);
    expect((await rows('gift_nudge')).map((r) => r.occasionDate)).toEqual([THREE_DAYS_AGO]);
  });
});

describe('once per person, list and occurrence', () => {
  it('sends nothing new on a re-run, nor on two overlapping runs', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    const ben = await user('ben');
    for (const u of [mia, ben]) {
      await join(l._id, u);
      await reserve(l._id, u);
    }

    const [one, two] = await Promise.all([sendGiftReminders(NOW), sendGiftReminders(NOW)]);
    expect(one.reminders.sent + two.reminders.sent).toBe(2);
    const again = await sendGiftReminders(new Date('2026-10-06T06:30:00Z'));
    expect(again.reminders.sent).toBe(0);
    expect(await rows('gift_reminder')).toHaveLength(2);
  });

  it('refuses a second row with the same key (the unique index), per phase', async () => {
    const key = {
      user: new Types.ObjectId(),
      wishlist: new Types.ObjectId(),
      occasionDate: IN_A_WEEK,
    };
    await Notification.create({ ...key, type: 'gift_reminder' });
    await Notification.create({ ...key, type: 'gift_nudge' });
    await Notification.create({ ...key, type: 'occasion_reminder' });
    await expect(Notification.create({ ...key, type: 'gift_reminder' })).rejects.toThrow(
      /duplicate key/
    );
    await expect(Notification.create({ ...key, type: 'gift_nudge' })).rejects.toThrow(
      /duplicate key/
    );
  });

  it('stops at the cap and carries the rest over to the next run', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    const ben = await user('ben');
    for (const u of [mia, ben]) {
      await join(l._id, u);
      await reserve(l._id, u);
    }

    const first = await sendGiftReminders(NOW, 1);
    expect(first.reminders).toEqual({ lists: 1, sent: 1, capped: true });
    const second = await sendGiftReminders(NOW, 1);
    expect(second.reminders.sent).toBe(1);
    expect(await rows('gift_reminder')).toHaveLength(2);
  });
});

describe('createGiftReminders re-check after the write', () => {
  const due = (l: { _id: Types.ObjectId; name: string; slug?: string | null }) => ({
    _id: l._id,
    name: l.name,
    slug: l.slug ?? null,
    occasion: birthdayIn(IN_A_WEEK),
    occasionDate: IN_A_WEEK,
  });

  // A promotion, kick, give, archive or opt-out landing between the run's read
  // and its write: the row just written is taken back.
  it('takes back the row of someone made an owner since, keeping the rest', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const promoted = await user('promoted');
    const stays = await user('stays');
    for (const u of [promoted, stays]) {
      await join(l._id, u);
      await reserve(l._id, u);
    }
    // Becoming an owner grants ownership first (its release comes after).
    await Wishlist.updateOne({ _id: l._id }, { $push: { owners: promoted } });

    const sent = await createGiftReminders('gift_reminder', due(l), [promoted, stays]);
    expect(sent).toBe(1);
    expect(await recipients('gift_reminder')).toEqual([String(stays)]);
  });

  it('takes back the row of someone kicked, who gave it, or who turned it off since', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const [kicked, gave, off] = [await user('kicked'), await user('gave'), await user('off')];
    for (const u of [kicked, gave, off]) await join(l._id, u);
    await reserve(l._id, kicked);
    const g = await reserve(l._id, gave);
    await reserve(l._id, off);
    await WishlistMember.deleteOne({ wishlist: l._id, user: kicked });
    await Reservation.deleteOne({ _id: g.reservation._id });
    await User.updateOne(
      { _id: off },
      { $set: { 'notificationPrefs.gift_reminder.inApp': false } }
    );

    expect(await createGiftReminders('gift_reminder', due(l), [kicked, gave, off])).toBe(0);
    expect(await rows('gift_reminder')).toHaveLength(0);
  });

  it('takes back every row on a list archived, deleted or moved since, but never an earlier run’s', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const early = await user('early');
    const late = await user('late');
    for (const u of [early, late]) {
      await join(l._id, u);
      await reserve(l._id, u);
    }
    expect(await createGiftReminders('gift_reminder', due(l), [early])).toBe(1);

    await Wishlist.updateOne({ _id: l._id }, { $set: { archived: true } });
    expect(await createGiftReminders('gift_reminder', due(l), [late])).toBe(0);
    await Wishlist.updateOne(
      { _id: l._id },
      { $set: { archived: false, 'occasion.date': '2026-12-01' } }
    );
    expect(await createGiftReminders('gift_reminder', due(l), [late])).toBe(0);
    await Wishlist.deleteOne({ _id: l._id });
    expect(await createGiftReminders('gift_reminder', due(l), [late])).toBe(0);

    expect(await recipients('gift_reminder')).toEqual([String(early)]);
  });
});

describe('the feed re-checks it on every read', () => {
  async function remindedHolder() {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    await join(l._id, mia);
    const r = await reserve(l._id, mia);
    await sendGiftReminders(NOW);
    return { l, mia, ...r };
  }

  it('shows it to the holder with its kind and day, linking nowhere else', async () => {
    const { l, mia } = await remindedHolder();
    const body = await feedAs(mia);
    expect(body.unreadCount).toBe(1);
    expect(body.data[0]).toMatchObject({
      type: 'gift_reminder',
      occasionKind: 'birthday',
      occasionDate: IN_A_WEEK,
      wishlistName: l.name,
      itemName: null,
      actorUsername: null,
    });
  });

  it('hides it, and its unread count, once they’re made an owner', async () => {
    const { l, mia } = await remindedHolder();
    await Wishlist.updateOne({ _id: l._id }, { $push: { owners: mia } });
    const body = await feedAs(mia);
    expect(body.data).toHaveLength(0);
    expect(body.unreadCount).toBe(0);
  });

  it('hides it once they leave or are kicked, though their Reservation stays', async () => {
    const { l, mia } = await remindedHolder();
    await WishlistMember.deleteOne({ wishlist: l._id, user: mia });
    expect((await feedAs(mia)).data).toHaveLength(0);
  });

  // regression: the feed checks each row by its own phase and occurrence, so a
  // nudge about a gift since given isn't brought back by a later reservation.
  it('keeps a nudge hidden once given, even after a new reservation for a later occurrence', async () => {
    const l = await list(birthdayIn(THREE_DAYS_AGO));
    const mia = await user('mia');
    await join(l._id, mia);
    const { reservation } = await reserve(l._id, mia, {
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });
    await sendGiftReminders(NOW);
    expect((await feedAs(mia)).unreadCount).toBe(1);

    await Reservation.deleteOne({ _id: reservation._id });
    await reserve(l._id, mia);
    const body = await feedAs(mia);
    expect(body.data).toHaveLength(0);
    expect(body.unreadCount).toBe(0);
  });

  it('hides a non-organizer’s reminder rows only when they leave the gift', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const org = await user('org');
    const pal = await user('pal');
    await join(l._id, org);
    await join(l._id, pal);
    const { gift } = await groupGift(l._id, [org, pal]);
    await sendGiftReminders(NOW);
    expect((await feedAs(pal)).unreadCount).toBe(1);
    await GroupGift.updateOne({ _id: gift._id }, { $pull: { contributors: { user: pal } } });
    expect((await feedAs(pal)).unreadCount).toBe(0);
  });

  it('hides it once nothing is held (marked as given), and while the list is archived', async () => {
    const { l, mia, reservation } = await remindedHolder();
    await Wishlist.updateOne({ _id: l._id }, { $set: { archived: true } });
    expect((await feedAs(mia)).unreadCount).toBe(0);
    await Wishlist.updateOne({ _id: l._id }, { $set: { archived: false } });
    expect((await feedAs(mia)).unreadCount).toBe(1);
    await Reservation.deleteOne({ _id: reservation._id });
    expect((await feedAs(mia)).data).toHaveLength(0);
  });
});

describe('email', () => {
  it('is off by default: no email, no claim', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia');
    await join(l._id, mia);
    await reserve(l._id, mia);

    expect((await sendGiftReminders(NOW)).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
  });

  it('goes once to a holder who turned it on, saying no more than the row', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia', {
      notificationPrefs: { gift_reminder: { email: true, inApp: false } },
    });
    const idle = await user('idle', { notificationPrefs: { gift_reminder: { email: true } } });
    await join(l._id, mia);
    await join(l._id, idle);
    await reserve(l._id, mia);

    expect((await sendGiftReminders(NOW)).emailed).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith('mia@x.com', {
      recipientId: String(mia),
      type: 'gift_reminder',
      wishlistId: String(l._id),
      wishlistName: l.name,
      wishlistSlug: l.slug,
      occasionKind: 'birthday',
      occasionDate: IN_A_WEEK,
    });
    // Its own setting: off in app, so no row.
    expect(await rows('gift_reminder')).toHaveLength(0);

    expect((await sendGiftReminders(NOW)).emailed).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('nudges by email after the occasion on its own setting', async () => {
    const l = await list(birthdayIn(THREE_DAYS_AGO));
    const mia = await user('mia', { notificationPrefs: { gift_nudge: { email: true } } });
    await join(l._id, mia);
    await reserve(l._id, mia, { createdAt: new Date('2026-09-01T00:00:00Z') });

    expect((await sendGiftReminders(NOW)).emailed).toBe(1);
    expect(sendEmail.mock.calls[0][1]).toMatchObject({
      type: 'gift_nudge',
      occasionDate: THREE_DAYS_AGO,
    });
  });

  it('claims first, then re-reads: someone made an owner meanwhile gets nothing, the claim given back', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia', { notificationPrefs: { gift_reminder: { email: true } } });
    await join(l._id, mia);
    await reserve(l._id, mia);
    const real = (
      await vi.importActual<typeof import('@/lib/notificationEmails')>('@/lib/notificationEmails')
    ).claimOccurrenceEmail;
    claim.mockImplementationOnce(async (...args) => {
      await Wishlist.updateOne({ _id: l._id }, { $push: { owners: mia } });
      return real(...args);
    });

    expect((await sendGiftReminders(NOW)).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
  });

  it('claims first, then re-reads: a gift given or a list archived meanwhile sends nothing', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia', { notificationPrefs: { gift_reminder: { email: true } } });
    await join(l._id, mia);
    const { reservation } = await reserve(l._id, mia);
    const real = (
      await vi.importActual<typeof import('@/lib/notificationEmails')>('@/lib/notificationEmails')
    ).claimOccurrenceEmail;
    claim.mockImplementationOnce(async (...args) => {
      await Reservation.deleteOne({ _id: reservation._id });
      return real(...args);
    });
    expect((await sendGiftReminders(NOW)).emailed).toBe(0);

    const other = await list(birthdayIn(IN_A_WEEK));
    await join(other._id, mia);
    await reserve(other._id, mia);
    claim.mockImplementationOnce(async (...args) => {
      await Wishlist.updateOne({ _id: other._id }, { $set: { archived: true } });
      return real(...args);
    });
    expect((await sendGiftReminders(NOW)).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when the send fails, so the next run sends it', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    const mia = await user('mia', { notificationPrefs: { gift_reminder: { email: true } } });
    await join(l._id, mia);
    await reserve(l._id, mia);

    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    expect((await sendGiftReminders(NOW)).emailed).toBe(0);
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
    expect((await sendGiftReminders(NOW)).emailed).toBe(1);
  });

  it('stops at the email cap, carrying the rest over', async () => {
    const l = await list(birthdayIn(IN_A_WEEK));
    for (const name of ['a', 'b']) {
      const u = await user(name, { notificationPrefs: { gift_reminder: { email: true } } });
      await join(l._id, u);
      await reserve(l._id, u);
    }
    expect((await sendGiftReminders(NOW, 500, 1)).emailed).toBe(1);
    expect((await sendGiftReminders(NOW, 500, 1)).emailed).toBe(1);
    expect((await sendGiftReminders(NOW, 500, 1)).emailed).toBe(0);
  });
});
