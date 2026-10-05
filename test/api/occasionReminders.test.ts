import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Occasion reminders (WIS-193): a week before a list's occasion, its members
// (never its owners, never friends who could merely see it) get one in-app
// reminder, once per occurrence, unless they turned them off. Archived lists
// send nothing, and a reminder carries nothing about bookings.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as CRON } from '@/app/api/cron/occasion-reminders/route';
import { GET as FEED } from '@/app/api/notifications/route';
import { PATCH as PATCH_ME } from '@/app/api/users/me/route';
import { sendOccasionReminders } from '@/lib/utils/occasionReminders';
import { createOccasionReminders } from '@/lib/notifications';
import Notification from '@/models/Notification';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Follow from '@/models/Follow';
import type { Occasion } from '@/lib/utils/occasion';

const session = vi.mocked(auth);

// Monday 5 Oct 2026, 06:00 UTC: a week ahead is Monday 12 Oct.
const NOW = new Date('2026-10-05T06:00:00Z');
const IN_A_WEEK = '2026-10-12';

let owner: Types.ObjectId;
let seq = 0;

beforeAll(async () => {
  await connectTestDB();
  await Notification.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
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

const reminders = (filter: Record<string, unknown> = {}) =>
  Notification.find({ type: 'occasion_reminder', ...filter }).lean();

const cron = (token?: string) =>
  CRON(
    new NextRequest('http://localhost/api/cron/occasion-reminders', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

describe('GET /api/cron/occasion-reminders', () => {
  it('500s without CRON_SECRET and 401s a wrong or missing token, sending nothing', async () => {
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, await user('mia'));

    expect((await cron()).status).toBe(401);
    expect((await cron('wrong')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await cron('cron-secret')).status).toBe(500);
    expect(await reminders()).toHaveLength(0);
  });

  it('runs with the right token and answers counts only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, await user('mia'));

    const res = await cron('cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, lists: 1, sent: 1, capped: false });
  });
});

describe('sendOccasionReminders', () => {
  it('reminds members only: not owners, not friends who can see the list', async () => {
    const mia = await user('mia');
    const friend = await user('friend');
    // A mutual follow with the owner: a friend who can see the friends-only list.
    await Follow.create({ follower: friend, following: owner });
    await Follow.create({ follower: owner, following: friend });
    const l = await list({ kind: 'birthday', date: '2000-10-12', recurrence: 'yearly' });
    await join(l._id, mia);

    expect(await sendOccasionReminders(NOW)).toEqual({ lists: 1, sent: 1, capped: false });
    const rows = await reminders();
    expect(rows.map((r) => String(r.user))).toEqual([String(mia)]);
    expect(rows[0]).toMatchObject({
      wishlistName: l.name,
      wishlistSlug: l.slug,
      occasionKind: 'birthday',
      // The real next occurrence, never the yearly one's stored year.
      occasionDate: IN_A_WEEK,
      actorUsername: null,
      itemName: null,
      count: 1,
      read: false,
    });
    expect(rows[0].actor).toBeUndefined();
  });

  it('defensively skips an owner who also has a member row', async () => {
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, owner);
    expect((await sendOccasionReminders(NOW)).sent).toBe(0);
  });

  it('sends nothing for an archived list, one outside the window, or a passed one-off', async () => {
    const mia = await user('mia');
    const archived = await list(
      { kind: 'birthday', date: IN_A_WEEK, recurrence: null },
      { archived: true }
    );
    const tooFar = await list({ kind: 'wedding', date: '2026-10-13', recurrence: null });
    const tooClose = await list({ kind: 'wedding', date: '2026-10-09', recurrence: null });
    const passed = await list({ kind: 'wedding', date: '2025-10-12', recurrence: null });
    const none = await list(null);
    for (const l of [archived, tooFar, tooClose, passed, none]) await join(l._id, mia);

    expect(await sendOccasionReminders(NOW)).toEqual({ lists: 0, sent: 0, capped: false });
    expect(await reminders()).toHaveLength(0);
  });

  it('catches up for two days after a missed run, naming the real day', async () => {
    const mia = await user('mia');
    const l = await list({ kind: 'holiday', date: '2026-10-10', recurrence: null });
    await join(l._id, mia);

    expect((await sendOccasionReminders(NOW)).sent).toBe(1);
    expect((await reminders())[0].occasionDate).toBe('2026-10-10');
  });

  it('reminds about a yearly Feb 29 on the Feb 28 of a year without one', async () => {
    const mia = await user('mia');
    const l = await list({ kind: 'birthday', date: '2000-02-29', recurrence: 'yearly' });
    await join(l._id, mia);

    expect((await sendOccasionReminders(new Date('2027-02-21T06:00:00Z'))).sent).toBe(1);
    expect((await reminders())[0].occasionDate).toBe('2027-02-28');
  });

  it('is idempotent per list and occurrence: re-runs send nothing, even once read', async () => {
    const mia = await user('mia');
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, mia);

    expect((await sendOccasionReminders(NOW)).sent).toBe(1);
    await Notification.updateMany({}, { $set: { read: true } });
    // The next day is still inside the catch-up window.
    expect((await sendOccasionReminders(new Date('2026-10-06T06:00:00Z'))).sent).toBe(0);
    const rows = await reminders();
    expect(rows).toHaveLength(1);
    expect(rows[0].read).toBe(true);
  });

  it('sends once when two runs overlap', async () => {
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    for (const name of ['mia', 'ivan', 'olga']) await join(l._id, await user(name));

    const runs = await Promise.all([sendOccasionReminders(NOW), sendOccasionReminders(NOW)]);
    expect(runs[0].sent + runs[1].sent).toBe(3);
    expect(await reminders()).toHaveLength(3);
  });

  it('reminds again for next year’s occurrence of a yearly occasion', async () => {
    const mia = await user('mia');
    const l = await list({ kind: 'birthday', date: '2000-10-12', recurrence: 'yearly' });
    await join(l._id, mia);

    await sendOccasionReminders(NOW);
    await sendOccasionReminders(new Date('2027-10-05T06:00:00Z'));
    expect((await reminders()).map((r) => r.occasionDate).sort()).toEqual([
      '2026-10-12',
      '2027-10-12',
    ]);
  });

  it('skips anyone who turned occasion reminders off', async () => {
    const off = await user('off', { notificationPrefs: { occasion_reminder: { inApp: false } } });
    const on = await user('on', { notificationPrefs: { occasion_reminder: { inApp: true } } });
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, off);
    await join(l._id, on);

    await sendOccasionReminders(NOW);
    expect((await reminders()).map((r) => String(r.user))).toEqual([String(on)]);
  });

  it('stops at the cap, nearest occasion first, and the next run sends the rest', async () => {
    const soon = await list({ kind: 'birthday', date: '2026-10-10', recurrence: null });
    const later = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    const people = [await user('a1'), await user('a2'), await user('a3')];
    for (const p of people) await join(later._id, p);
    await join(soon._id, people[0]);

    expect(await sendOccasionReminders(NOW, 2)).toEqual({ lists: 2, sent: 2, capped: true });
    // The list closest to its last day went first.
    expect(await reminders({ wishlist: soon._id })).toHaveLength(1);
    expect(await reminders({ wishlist: later._id })).toHaveLength(1);

    expect(await sendOccasionReminders(NOW, 2)).toEqual({ lists: 1, sent: 2, capped: false });
    expect(await reminders({ wishlist: later._id })).toHaveLength(3);
  });

  it('shows in the recipient’s feed with its kind and day', async () => {
    const mia = await user('mia');
    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, mia);
    await sendOccasionReminders(NOW);

    session.mockResolvedValue({ user: { id: String(mia) } } as never);
    const res = await FEED(new NextRequest('http://localhost/api/notifications?actors=1'));
    const body = await res.json();
    expect(body.unreadCount).toBe(1);
    expect(body.data[0]).toMatchObject({
      type: 'occasion_reminder',
      occasionKind: 'birthday',
      occasionDate: IN_A_WEEK,
      wishlistName: l.name,
      actorUsername: null,
      actorId: null,
    });
  });
});

describe('createOccasionReminders re-check after the write', () => {
  const occasion = { kind: 'birthday' as const, date: IN_A_WEEK, recurrence: null };

  // A kick, archive, occasion change or opt-out that lands between the run's
  // read of the list and its write: the reminder just written is taken back.
  it('takes back the reminder of someone who is no longer a member', async () => {
    const l = await list(occasion);
    const gone = await user('gone');
    const stays = await user('stays');
    await join(l._id, stays);

    const sent = await createOccasionReminders({
      wishlist: l,
      occasion,
      occasionDate: IN_A_WEEK,
      users: [gone, stays],
    });
    expect(sent).toBe(1);
    expect((await reminders()).map((r) => String(r.user))).toEqual([String(stays)]);
  });

  it('takes back every reminder when the list was archived, deleted or its date moved', async () => {
    const mia = await user('mia');
    const archived = await list(occasion, { archived: true });
    const moved = await list({ ...occasion, date: '2026-10-20' });
    const deleted = await list(occasion);
    for (const l of [archived, moved, deleted]) await join(l._id, mia);
    await Wishlist.deleteOne({ _id: deleted._id });

    for (const l of [archived, moved, deleted]) {
      expect(
        await createOccasionReminders({
          wishlist: l,
          occasion,
          occasionDate: IN_A_WEEK,
          users: [mia],
        })
      ).toBe(0);
    }
    expect(await reminders()).toHaveLength(0);
  });

  it('takes back the reminder of someone who turned reminders off meanwhile, or became an owner', async () => {
    const off = await user('off', { notificationPrefs: { occasion_reminder: { inApp: false } } });
    const promoted = await user('promoted');
    const l = await list(occasion, { owners: [owner, promoted] });
    await join(l._id, off);
    await join(l._id, promoted);

    expect(
      await createOccasionReminders({
        wishlist: l,
        occasion,
        occasionDate: IN_A_WEEK,
        users: [off, promoted],
      })
    ).toBe(0);
    expect(await reminders()).toHaveLength(0);
  });

  it('never deletes a reminder an earlier run wrote', async () => {
    const mia = await user('mia');
    const l = await list(occasion);
    await join(l._id, mia);
    await sendOccasionReminders(NOW);
    await WishlistMember.deleteMany({ user: mia });

    expect(
      await createOccasionReminders({
        wishlist: l,
        occasion,
        occasionDate: IN_A_WEEK,
        users: [mia],
      })
    ).toBe(0);
    expect(await reminders()).toHaveLength(1);
  });
});

describe('PATCH /api/users/me notificationPrefs', () => {
  const patch = (body: unknown) =>
    PATCH_ME(
      new NextRequest('http://localhost/api/users/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

  it('turns occasion reminders off by their own path, leaving the rest alone', async () => {
    const mia = await user('mia', { privacy: { searchable: false } });
    session.mockResolvedValue({ user: { id: String(mia) } } as never);

    const res = await patch({ notificationPrefs: { occasion_reminder: { inApp: false } } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.notificationPrefs).toEqual({
      occasion_reminder: { inApp: false },
    });
    const saved = await User.findById(mia).lean();
    expect(saved?.notificationPrefs).toEqual({ occasion_reminder: { inApp: false } });
    expect(saved?.privacy?.searchable).toBe(false);

    const l = await list({ kind: 'birthday', date: IN_A_WEEK, recurrence: null });
    await join(l._id, mia);
    expect((await sendOccasionReminders(NOW)).sent).toBe(0);
  });

  it('refuses an unknown notification setting', async () => {
    const mia = await user('mia');
    session.mockResolvedValue({ user: { id: String(mia) } } as never);
    const res = await patch({ notificationPrefs: { occasion_reminder: { email: true } } });
    expect(res.status).toBe(400);
  });
});
