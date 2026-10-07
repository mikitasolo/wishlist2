import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Friends' birthday reminders (WIS-345): a week before someone's birthday,
// each friend who may see it gets one reminder about the person (never a
// list), once per occurrence, unless one of the person's Birthday lists coming
// up in the same window already reminds them as its member.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { sendNotificationEmail } from '@/lib/email';
import { GET as CRON } from '@/app/api/cron/birthdays/route';
import { GET as FEED } from '@/app/api/notifications/route';
import { createBirthdayReminders, sendBirthdayReminders } from '@/lib/utils/birthdayReminders';
import { claimBirthdayReminderEmail } from '@/lib/notificationEmails';
import {
  BIRTHDAY_CRON_TOTAL_BUDGET_MS,
  BIRTHDAY_TASKS,
  runBirthdayTasks,
  type BirthdayTask,
} from '@/lib/utils/birthdayCron';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Follow from '@/models/Follow';
import type { Occasion } from '@/lib/utils/occasion';

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendNotificationEmail);

// Monday 5 Oct 2026, 06:00 UTC: a week ahead is Monday 12 Oct.
const NOW = new Date('2026-10-05T06:00:00Z');
const TODAY = '2026-10-05';
const IN_A_WEEK = '2026-10-12';
const BIRTHDAY = '2000-10-12';

let anna: Types.ObjectId;
let seq = 0;

beforeAll(async () => {
  await connectTestDB();
  await Notification.init();
  await NotificationEmailClaim.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  anna = await user('anna', { birthday: BIRTHDAY });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function user(name: string, extra: Record<string, unknown> = {}) {
  return (await User.create({ email: `${name}@x.com`, username: name, ...extra }))._id;
}

const follow = (follower: Types.ObjectId, following: Types.ObjectId) =>
  Follow.create({ follower, following });

async function befriend(a: Types.ObjectId, b: Types.ObjectId) {
  await follow(a, b);
  await follow(b, a);
}

/** A new friend of Anna's. */
async function friend(name: string, extra: Record<string, unknown> = {}) {
  const id = await user(name, extra);
  await befriend(anna, id);
  return id;
}

async function list(occasion: Occasion | null, extra: Record<string, unknown> = {}) {
  seq += 1;
  return Wishlist.create({
    name: `List ${seq}`,
    slug: `list-${seq}`,
    owners: [anna],
    visibility: 'friends',
    occasion,
    ...extra,
  });
}

const birthdayList = (date = IN_A_WEEK, extra: Record<string, unknown> = {}) =>
  list({ kind: 'birthday', date, recurrence: null }, extra);

const join = (wishlist: Types.ObjectId, member: Types.ObjectId) =>
  WishlistMember.create({ wishlist, user: member });

const reminders = (filter: Record<string, unknown> = {}) =>
  Notification.find({ type: 'birthday_reminder', ...filter }).lean();

const remindedIds = async () => (await reminders()).map((r) => String(r.user)).sort();

const run = (at: Date = NOW, maxPerRun?: number, maxEmailsPerRun?: number) =>
  sendBirthdayReminders(at, { maxPerRun, maxEmailsPerRun });

const cron = (token?: string) =>
  CRON(
    new NextRequest('http://localhost/api/cron/birthdays', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

describe('GET /api/cron/birthdays', () => {
  it('500s without CRON_SECRET and 401s a wrong or missing token, sending nothing', async () => {
    await friend('mia');
    expect((await cron()).status).toBe(401);
    expect((await cron('wrong')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await cron('cron-secret')).status).toBe(500);
    expect(await reminders()).toHaveLength(0);
  });

  it('runs with the right token and answers counts only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await friend('mia');
    const res = await cron('cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      reminders: { people: 1, sent: 1, capped: false, emailed: 0 },
      // Anna's birthday is a week off: not due her own nudge (WIS-344).
      nudges: { emailed: 0, capped: false },
    });
  });
});

describe('runBirthdayTasks', () => {
  it('runs every task against its own deadline, in turn', async () => {
    const seen: number[] = [];
    const task = (name: string, budgetMs: number): BirthdayTask => ({
      name,
      budgetMs,
      run: async (_now, deadline) => {
        seen.push(deadline - Date.now());
        return { done: true };
      },
    });
    const result = await runBirthdayTasks(NOW, [task('a', 10_000), task('b', 20_000)]);
    expect(result).toEqual({ ok: true, results: { a: { done: true }, b: { done: true } } });
    expect(seen[0]).toBeGreaterThan(9_000);
    expect(seen[0]).toBeLessThanOrEqual(10_000);
    expect(seen[1]).toBeGreaterThan(19_000);
  });

  it('a task that throws is reported, and the next still runs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runBirthdayTasks(NOW, [
      { name: 'a', budgetMs: 1, run: () => Promise.reject(new TypeError('boom')) },
      { name: 'b', budgetMs: 1, run: async () => ({ sent: 2 }) },
    ]);
    expect(result).toEqual({ ok: false, results: { a: { failed: true }, b: { sent: 2 } } });
    expect(String(error.mock.calls[0][0])).toBe('Birthday task a failed (TypeError)');
  });

  it('the tasks’ budgets fit inside the cron’s 60s', () => {
    const total = BIRTHDAY_TASKS.reduce((sum, t) => sum + t.budgetMs, 0);
    expect(total).toBeLessThanOrEqual(BIRTHDAY_CRON_TOTAL_BUDGET_MS);
    expect(BIRTHDAY_CRON_TOTAL_BUDGET_MS).toBeLessThan(60_000);
  });

  it('a reminders run out of time stops, marks itself capped, and the next run sends the rest', async () => {
    await friend('mia');
    await friend('bo', { notificationPrefs: { birthday_reminder: { email: true } } });
    const out = await sendBirthdayReminders(NOW, { deadline: Date.now() - 1 });
    expect(out).toEqual({ people: 0, sent: 0, capped: true, emailed: 0 });
    expect(await reminders()).toHaveLength(0);
    expect(await sendBirthdayReminders(NOW)).toMatchObject({ sent: 2, emailed: 1, capped: false });
  });
});

describe('who is reminded', () => {
  it('friends only: not a one-way follower, not someone Anna follows, not a stranger', async () => {
    const mia = await friend('mia');
    const fan = await user('fan');
    await follow(fan, anna);
    const idol = await user('idol');
    await follow(anna, idol);
    await user('stranger');

    expect((await run()).sent).toBe(1);
    expect(await remindedIds()).toEqual([String(mia)]);
    const [row] = await reminders();
    expect(row).toMatchObject({
      actor: anna,
      actorUsername: 'anna',
      occasionDate: IN_A_WEEK,
      wishlist: null,
      wishlistName: null,
      read: false,
    });
    // Never Anna herself.
    expect(await reminders({ user: anna })).toHaveLength(0);
  });

  it.each([
    // birthdayVisibility × profileVisibility → friends reminded?
    [undefined, undefined, true],
    ['friends', 'everyone', true],
    ['everyone', 'everyone', true],
    ['everyone', 'friends', true],
    ['friends', 'friends', true],
    ['nobody', 'everyone', false],
    ['nobody', 'friends', false],
  ] as const)(
    'birthday %s, profile %s: friends reminded %s',
    async (birthdayVisibility, profileVisibility, reminded) => {
      await User.updateOne(
        { _id: anna },
        {
          $set: {
            ...(birthdayVisibility && { 'privacy.birthdayVisibility': birthdayVisibility }),
            ...(profileVisibility && { 'privacy.profileVisibility': profileVisibility }),
          },
        }
      );
      await friend('mia');
      await run();
      expect(await reminders()).toHaveLength(reminded ? 1 : 0);
    }
  );

  it('nobody, for a birthday not set or outside the window', async () => {
    const mia = await friend('mia');
    const ben = await user('ben', { birthday: '2000-10-20' });
    await befriend(ben, mia);
    const cleo = await user('cleo', { birthday: null });
    await befriend(cleo, mia);
    await User.updateOne({ _id: anna }, { $set: { birthday: null } });

    await run();
    expect(await reminders()).toHaveLength(0);
  });

  it('catches up for two days after a missed run, naming the real day', async () => {
    await friend('mia');
    await run(new Date('2026-10-07T06:00:00Z'));
    expect((await reminders()).map((r) => r.occasionDate)).toEqual([IN_A_WEEK]);
  });

  it('not before the window, nor after its catch-up', async () => {
    await friend('mia');
    await run(new Date('2026-10-04T06:00:00Z'));
    await run(new Date('2026-10-08T06:00:00Z'));
    expect(await reminders()).toHaveLength(0);
  });

  it('reminds about a Feb 29 birthday on the Feb 28 of a year without one', async () => {
    await User.updateOne({ _id: anna }, { $set: { birthday: '2000-02-29' } });
    await friend('mia');
    await run(new Date('2027-02-21T06:00:00Z'));
    expect((await reminders()).map((r) => r.occasionDate)).toEqual(['2027-02-28']);
  });
});

describe('a Birthday list coming up already reminds its members', () => {
  it('no list: every friend is reminded', async () => {
    await friend('mia');
    await friend('bo');
    await run();
    expect(await reminders()).toHaveLength(2);
  });

  it('one list: skips its members, reminds the other friends', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    const l = await birthdayList();
    await join(l._id, mia);
    await run();
    expect(await remindedIds()).toEqual([String(bo)]);
  });

  it('several lists: skips the members of any of them', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    const cleo = await friend('cleo');
    // One dated to the birthday, one to a party two days earlier (yearly).
    const family = await birthdayList();
    const party = await list({ kind: 'birthday', date: '2000-10-10', recurrence: 'yearly' });
    await join(family._id, mia);
    await join(party._id, bo);
    await run();
    expect(await remindedIds()).toEqual([String(cleo)]);
  });

  it('an archived list, one outside the window, another kind, or someone else’s does not skip', async () => {
    const [mia, bo, cleo, dan] = await Promise.all(
      ['mia', 'bo', 'cleo', 'dan'].map((n) => friend(n))
    );
    const archived = await birthdayList(IN_A_WEEK, { archived: true });
    const later = await birthdayList('2026-10-20');
    const wedding = await list({ kind: 'wedding', date: IN_A_WEEK, recurrence: null });
    const other = await user('other');
    const notHers = await birthdayList(IN_A_WEEK, { owners: [other] });
    await join(archived._id, mia);
    await join(later._id, bo);
    await join(wedding._id, cleo);
    await join(notHers._id, dan);
    await run();
    expect(await remindedIds()).toEqual([mia, bo, cleo, dan].map(String).sort());
  });

  it('a member who turned occasion reminders off on a channel is not covered on it', async () => {
    const mia = await friend('mia', {
      notificationPrefs: {
        occasion_reminder: { inApp: false },
        birthday_reminder: { email: true },
      },
    });
    const l = await birthdayList();
    await join(l._id, mia);
    const result = await run();
    // In app: the list's reminder won't reach her, so the birthday one does.
    expect(await remindedIds()).toEqual([String(mia)]);
    // Email: the list's occasion email is on, so it covers her.
    expect(result.emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a co-owner of her Birthday list is no member, so is reminded', async () => {
    const mia = await friend('mia');
    await birthdayList(IN_A_WEEK, { owners: [anna, mia] });
    await run();
    expect(await remindedIds()).toEqual([String(mia)]);
  });
});

describe('once, capped, and switched off', () => {
  it('is idempotent per friend, person and occurrence: re-runs send nothing, even once read', async () => {
    await friend('mia');
    expect((await run()).sent).toBe(1);
    await Notification.updateMany({}, { $set: { read: true } });
    expect((await run(new Date('2026-10-06T06:00:00Z'))).sent).toBe(0);
    expect(await reminders()).toHaveLength(1);
  });

  it('sends once when two runs overlap', async () => {
    await friend('mia');
    await friend('bo');
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(2);
    expect(await reminders()).toHaveLength(2);
  });

  it('two friends’ birthdays on the same day are two reminders', async () => {
    const mia = await friend('mia');
    const ben = await user('ben', { birthday: BIRTHDAY });
    await befriend(ben, mia);
    await run();
    expect((await reminders({ user: mia })).map((r) => r.actorUsername).sort()).toEqual([
      'anna',
      'ben',
    ]);
  });

  it('reminds again for next year’s birthday', async () => {
    await friend('mia');
    await run();
    await run(new Date('2027-10-05T06:00:00Z'));
    expect((await reminders()).map((r) => r.occasionDate).sort()).toEqual([
      IN_A_WEEK,
      '2027-10-12',
    ]);
  });

  it('skips anyone who turned the in-app reminder off', async () => {
    await friend('mia', { notificationPrefs: { birthday_reminder: { inApp: false } } });
    const bo = await friend('bo', { notificationPrefs: { occasion_reminder: { inApp: false } } });
    await run();
    expect(await remindedIds()).toEqual([String(bo)]);
  });

  it('stops at the cap, nearest birthday first, and the next run sends the rest', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    // Ben's birthday is two days nearer than Anna's.
    const ben = await user('ben', { birthday: '2000-10-10' });
    await befriend(ben, mia);

    const first = await run(NOW, 2);
    expect(first).toMatchObject({ sent: 2, capped: true });
    const after = await reminders();
    expect(after.filter((r) => r.actorUsername === 'ben')).toHaveLength(1);
    expect(after).toHaveLength(2);

    const second = await run(NOW, 2);
    expect(second).toMatchObject({ sent: 1, capped: false });
    expect(await remindedIds()).toEqual([mia, mia, bo].map(String).sort());
  });
});

describe('createBirthdayReminders re-check after the write', () => {
  const write = (users: Types.ObjectId[], occasionDate = IN_A_WEEK) =>
    createBirthdayReminders({
      person: { _id: anna, username: 'anna' },
      occasionDate,
      users,
      today: TODAY,
    });

  it('takes back the reminder of someone who is no longer a friend', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    await Follow.deleteOne({ follower: bo, following: anna });
    expect(await write([mia, bo])).toBe(1);
    expect(await remindedIds()).toEqual([String(mia)]);
  });

  it('takes back every reminder when the birthday was cleared, moved or hidden from friends', async () => {
    const mia = await friend('mia');
    for (const change of [
      { birthday: null },
      { birthday: '2000-10-13' },
      { 'privacy.birthdayVisibility': 'nobody' },
    ]) {
      await User.updateOne({ _id: anna }, { $set: { birthday: BIRTHDAY } });
      await User.updateOne({ _id: anna }, { $unset: { privacy: 1 } });
      await User.updateOne({ _id: anna }, { $set: change });
      expect(await write([mia])).toBe(0);
      expect(await reminders()).toHaveLength(0);
    }
  });

  it('takes back the reminder of someone who opted out, or whom a Birthday list now covers', async () => {
    const mia = await friend('mia', { notificationPrefs: { birthday_reminder: { inApp: false } } });
    const bo = await friend('bo');
    const cleo = await friend('cleo');
    const l = await birthdayList();
    await join(l._id, bo);
    expect(await write([mia, bo, cleo])).toBe(1);
    expect(await remindedIds()).toEqual([String(cleo)]);
  });

  it('never deletes a reminder an earlier run wrote', async () => {
    const mia = await friend('mia');
    await write([mia]);
    await Follow.deleteMany({});
    expect(await write([mia])).toBe(0);
    expect(await reminders()).toHaveLength(1);
  });
});

describe('in the feed', () => {
  it('names the person and the day, links to their profile, and shows their face', async () => {
    const mia = await friend('mia');
    await User.updateOne({ _id: anna }, { $set: { image: 'https://example.com/a.png' } });
    await run();
    session.mockResolvedValue({ user: { id: String(mia) } } as never);
    const res = await FEED(new NextRequest('http://localhost/api/notifications?actors=1'));
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      type: 'birthday_reminder',
      actorUsername: 'anna',
      actorId: String(anna),
      actorImage: 'https://example.com/a.png',
      occasionDate: IN_A_WEEK,
      occasionKind: null,
      wishlistId: null,
      wishlistName: null,
    });
  });
});

describe('in the feed, only while the birthday is still theirs to see', () => {
  const feed = async (viewer: Types.ObjectId) => {
    session.mockResolvedValue({ user: { id: String(viewer) } } as never);
    return (await FEED(new NextRequest('http://localhost/api/notifications'))).json();
  };

  it.each([
    ['hidden from friends', { $set: { 'privacy.birthdayVisibility': 'nobody' } }],
    ['cleared', { $set: { birthday: null } }],
    ['moved', { $set: { birthday: '2000-11-02' } }],
  ] as const)(
    'regression: a birthday %s after the reminder no longer shows in it, nor counts as unread',
    async (_, change) => {
      const mia = await friend('mia');
      await run();
      expect((await feed(mia)).unreadCount).toBe(1);
      await User.updateOne({ _id: anna }, change);
      const body = await feed(mia);
      expect(body.data).toEqual([]);
      expect(body.unreadCount).toBe(0);
      expect(await reminders()).toHaveLength(0);
    }
  );

  it('regression: no longer friends, it no longer shows; another friend’s stays', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    await run();
    await Follow.deleteOne({ follower: anna, following: mia });
    expect((await feed(mia)).data).toEqual([]);
    expect((await feed(bo)).data).toHaveLength(1);
  });

  it('re-checks only the rows the feed can show or count, and reads no friends when there are none', async () => {
    const mia = await friend('mia');
    await run();
    await Notification.updateMany({}, { $set: { read: true } });
    // Thirty newer rows push the read reminder out of the feed.
    const old = new Date(Date.now() - 60_000);
    await Notification.updateMany({ type: 'birthday_reminder' }, { $set: { createdAt: old } }, {
      overwriteImmutable: true,
    } as never);
    await Notification.insertMany(
      Array.from({ length: 30 }, () => ({ user: mia, type: 'follow', read: true }))
    );
    await User.updateOne({ _id: anna }, { $set: { 'privacy.birthdayVisibility': 'nobody' } });
    const follows = vi.spyOn(Follow, 'find');

    const body = await feed(mia);
    expect(body.data.some((n: { type: string }) => n.type === 'birthday_reminder')).toBe(false);
    // Out of reach of the feed: neither checked nor deleted, and no friends read.
    expect(await reminders()).toHaveLength(1);
    expect(follows).not.toHaveBeenCalled();
    follows.mockRestore();
  });

  it('re-checks an unread reminder however old, and a row a deletion brings into the feed', async () => {
    const mia = await friend('mia');
    const ben = await user('ben', { birthday: BIRTHDAY });
    await befriend(ben, mia);
    await run();
    const old = new Date(Date.now() - 60_000);
    await Notification.updateMany({ type: 'birthday_reminder' }, { $set: { createdAt: old } }, {
      overwriteImmutable: true,
    } as never);
    // Anna's is unread; Ben's is read and the 31st newest.
    await Notification.updateOne({ actorUsername: 'ben' }, { $set: { read: true } });
    await Notification.updateOne(
      { actorUsername: 'anna' },
      { $set: { createdAt: new Date(old.getTime() + 1) } },
      { overwriteImmutable: true } as never
    );
    await Notification.insertMany(
      Array.from({ length: 29 }, () => ({ user: mia, type: 'follow', read: true }))
    );
    await User.updateOne({ _id: anna }, { $set: { birthday: null } });
    await User.updateOne({ _id: ben }, { $set: { 'privacy.birthdayVisibility': 'nobody' } });

    const body = await feed(mia);
    expect(body.unreadCount).toBe(0);
    expect(body.data.some((n: { type: string }) => n.type === 'birthday_reminder')).toBe(false);
    // Anna's (unread) went first; that brought Ben's into the feed, so it went too.
    expect(await reminders()).toHaveLength(0);
  });

  it('regression: a failed re-check leaves every birthday reminder out of the rows and the unread count', async () => {
    const mia = await friend('mia');
    await run();
    await Notification.create({ user: mia, type: 'follow', actorUsername: 'bo', read: false });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const find = vi.spyOn(User, 'find').mockImplementationOnce(() => {
      throw new Error('db down');
    });
    const body = await feed(mia);
    find.mockRestore();
    expect(error).toHaveBeenCalled();
    expect(body.data.map((n: { type: string }) => n.type)).toEqual(['follow']);
    expect(body.unreadCount).toBe(1);
    // Nothing deleted: it shows again once the re-check works.
    expect(await reminders()).toHaveLength(1);
    expect((await feed(mia)).unreadCount).toBe(2);
  });

  it('names and links the person by their username now, not the one written', async () => {
    const mia = await friend('mia');
    await run();
    await User.updateOne({ _id: anna }, { $set: { username: 'anna_k' } });
    await User.create({ email: 'new-anna@x.com', username: 'anna' });
    const { data } = await feed(mia);
    expect(data[0].actorUsername).toBe('anna_k');
  });
});

describe('emails', () => {
  it('none by default', async () => {
    await friend('mia');
    expect((await run()).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('to a friend who turned it on, once per occurrence, however many runs', async () => {
    await friend('mia', { notificationPrefs: { birthday_reminder: { email: true } } });
    expect((await run()).emailed).toBe(1);
    await run(new Date('2026-10-06T06:00:00Z'));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, details] = sendEmail.mock.calls[0];
    expect(to).toBe('mia@x.com');
    expect(details).toMatchObject({
      type: 'birthday_reminder',
      actorUsername: 'anna',
      wishlistId: null,
      wishlistName: null,
      occasionDate: IN_A_WEEK,
    });
  });

  it('the email and the in-app reminder are switched apart', async () => {
    await friend('mia', {
      notificationPrefs: { birthday_reminder: { inApp: false, email: true } },
    });
    const result = await run();
    expect(result).toMatchObject({ sent: 0, emailed: 1 });
    expect(await reminders()).toHaveLength(0);
  });

  it('not to a member of her Birthday list coming up, nor when hidden from friends', async () => {
    const mia = await friend('mia', { notificationPrefs: { birthday_reminder: { email: true } } });
    const l = await birthdayList();
    await join(l._id, mia);
    await run();
    expect(sendEmail).not.toHaveBeenCalled();

    await WishlistMember.deleteMany({});
    await User.updateOne({ _id: anna }, { $set: { 'privacy.birthdayVisibility': 'nobody' } });
    await run();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a failed send gives the claim back, and the next run tries again', async () => {
    await friend('mia', { notificationPrefs: { birthday_reminder: { email: true } } });
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    expect((await run()).emailed).toBe(0);
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
    expect((await run()).emailed).toBe(1);
  });

  it('stops at its own cap; the rest go out on the next run', async () => {
    const on = { notificationPrefs: { birthday_reminder: { email: true } } };
    await friend('mia', on);
    await friend('bo', on);
    expect((await run(NOW, undefined, 1)).emailed).toBe(1);
    expect((await run(NOW, undefined, 1)).emailed).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('account deletion', () => {
  it('removes the reminders and email claims to and about the person', async () => {
    const mia = await friend('mia');
    const bo = await friend('bo');
    const ben = await user('ben', { birthday: BIRTHDAY });
    await befriend(ben, mia);
    await run();
    await claimBirthdayReminderEmail(mia, anna, IN_A_WEEK);
    await claimBirthdayReminderEmail(anna, ben, IN_A_WEEK);
    await claimBirthdayReminderEmail(mia, ben, IN_A_WEEK);
    await befriend(ben, anna);
    await createBirthdayReminders({
      person: { _id: ben, username: 'ben' },
      occasionDate: IN_A_WEEK,
      users: [anna],
      today: TODAY,
    });
    expect(await reminders({ user: anna })).toHaveLength(1);

    expect(await deleteAccount(String(anna), { agreedListIds: [] })).toBe('deleted');
    expect(await reminders({ actor: anna })).toHaveLength(0);
    expect(await reminders({ user: anna })).toHaveLength(0);
    // Mia's reminder about Ben stays; Bo's about Anna is gone.
    expect((await reminders()).map((r) => [String(r.user), r.actorUsername])).toEqual([
      [String(mia), 'ben'],
    ]);
    expect(await reminders({ user: bo })).toHaveLength(0);
    const claims = await NotificationEmailClaim.find().lean();
    expect(claims.map((c) => [String(c.user), String(c.about)])).toEqual([
      [String(mia), String(ben)],
    ]);
  });
});

describe('follow-ups (WIS-347)', () => {
  const feed = async (viewer: Types.ObjectId) => {
    session.mockResolvedValue({ user: { id: String(viewer) } } as never);
    return (await FEED(new NextRequest('http://localhost/api/notifications'))).json();
  };

  // The run's two dates are always within the window's two days of each other,
  // so these hold by the window too; `listCoversBirthday` (unit) pins the 7 days.
  it('a Birthday list she co-owns for someone else’s birthday covers nobody; one near hers does', async () => {
    const [mia, bo] = await Promise.all([friend('mia'), friend('bo')]);
    const kid = await user('kid');
    // Her child's list, co-owned, on the child's birthday three weeks later.
    const kids = await birthdayList('2026-11-02', { owners: [anna, kid] });
    // Her own party, two days before her birthday.
    const party = await list({ kind: 'birthday', date: '2000-10-10', recurrence: 'yearly' });
    await join(kids._id, mia);
    await join(party._id, bo);
    await run();
    expect(await remindedIds()).toEqual([String(mia)]);
  });

  it('reads each person’s friends and Birthday lists once to pick who’s pending, re-checking after the write and each claim', async () => {
    const on = { notificationPrefs: { birthday_reminder: { email: true } } };
    await friend('mia', on);
    await friend('bo', on);
    const lists = vi.spyOn(Wishlist, 'find');
    const result = await run();
    expect(result).toMatchObject({ sent: 2, emailed: 2 });
    // Once to pick who's pending (both channels), once in the in-app re-check,
    // and once after each email's claim: the picking isn't repeated per channel.
    expect(lists).toHaveBeenCalledTimes(4);
    lists.mockRestore();
  });

  it('the feed reads nothing more than one existence check for a reader with no birthday reminder', async () => {
    const mia = await friend('mia');
    await Notification.create({ user: mia, type: 'follow', actorUsername: 'bo', read: false });
    const finds = vi.spyOn(Notification, 'find');
    const follows = vi.spyOn(Follow, 'find');
    const body = await feed(mia);
    expect(body.data.map((n: { type: string }) => n.type)).toEqual(['follow']);
    expect(body.unreadCount).toBe(1);
    // The feed's own read of its rows only.
    expect(finds).toHaveBeenCalledTimes(1);
    expect(follows).not.toHaveBeenCalled();
    finds.mockRestore();
    follows.mockRestore();
  });

  it('regression: the feed admits each reminder on its own, never one no re-check pass reached', async () => {
    // The re-check returned names by person: once one reminder about Anna
    // passed, any other about her showed, even one no pass had checked (a
    // stale date). Three stale rows use up the three passes, bringing an
    // unchecked, stale-dated one about Anna into the feed.
    const mia = await friend('mia');
    const strangers = await Promise.all(
      ['ben', 'cleo', 'dan'].map((n) => user(n, { birthday: BIRTHDAY }))
    );
    const t0 = Date.now();
    const at = (s: number) => new Date(t0 - s * 1000);
    const birthdayRow = (actor: Types.ObjectId, occasionDate: string, s: number) => ({
      user: mia,
      type: 'birthday_reminder',
      actor,
      actorUsername: 'x',
      occasionDate,
      count: 1,
      read: true,
      createdAt: at(s),
    });
    await Notification.collection.insertMany([
      birthdayRow(anna, IN_A_WEEK, 0),
      ...Array.from({ length: 28 }, (_, i) => ({
        user: mia,
        type: 'follow',
        actorUsername: 'bo',
        count: 1,
        read: true,
        createdAt: at(i + 1),
      })),
      ...strangers.map((s, i) => birthdayRow(s, IN_A_WEEK, 29 + i)),
      // Anna's birthday never fell on this day: stale.
      birthdayRow(anna, '2026-10-11', 32),
    ]);

    const { data } = await feed(mia);
    const shown = data.filter((n: { type: string }) => n.type === 'birthday_reminder');
    expect(shown.map((n: { occasionDate: string }) => n.occasionDate)).toEqual([IN_A_WEEK]);
    expect(shown[0].actorUsername).toBe('anna');
    // The strangers' went; the unchecked one stays for a later read to judge.
    expect((await reminders()).map((r) => r.occasionDate).sort()).toEqual([
      '2026-10-11',
      IN_A_WEEK,
    ]);
    // The next read reaches it, and takes it back.
    expect((await feed(mia)).data).toHaveLength(29);
    expect(await reminders()).toHaveLength(1);
  });
});
