import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The birthday nudge email (WIS-344): three weeks before your profile birthday,
// unless a Birthday list of yours (co-owned included, archived not) is coming,
// once a year through a claim taken first and re-checked after, by its own
// setting, capped per run with two days of catch-up.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendBirthdayNudgeEmail: vi.fn() }));

import { sendBirthdayNudgeEmail } from '@/lib/email';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as CRON } from '@/app/api/cron/birthdays/route';
import {
  BIRTHDAY_NUDGE_MAX_PER_RUN,
  sendBirthdayNudgeEmails,
} from '@/lib/utils/birthdayNudgeEmails';
import { claimBirthdayNudgeEmail } from '@/lib/notificationEmails';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import type { Occasion } from '@/lib/utils/occasion';

const sendEmail = vi.mocked(sendBirthdayNudgeEmail);

// Tuesday 6 Oct 2026, 06:30 UTC: three weeks ahead is Tuesday 27 Oct.
const NOW = new Date('2026-10-06T06:30:00Z');
const BIRTHDAY = '2000-10-27';

let seq = 0;

beforeAll(async () => {
  await connectTestDB();
  await NotificationEmailClaim.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', 'cron-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setRateLimiters(null);
});

async function user(name: string, extra: Record<string, unknown> = {}) {
  return (
    await User.create({ email: `${name}@x.com`, username: name, birthday: BIRTHDAY, ...extra })
  )._id;
}

async function list(owners: Types.ObjectId[], occasion: Occasion | null, extra = {}) {
  seq += 1;
  return Wishlist.create({
    name: `List ${seq}`,
    slug: `list-${seq}`,
    owners,
    visibility: 'friends',
    occasion,
    ...extra,
  });
}

const birthdayOn = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: null });

/** Who was emailed, by address, in order. */
const emailed = () => sendEmail.mock.calls.map((c) => c[0]);

const cron = (token?: string) =>
  CRON(
    new NextRequest('http://localhost/api/cron/birthdays', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

describe('GET /api/cron/birthdays (its nudges task)', () => {
  it('401s a wrong or missing token, sending nothing', async () => {
    await user('ann');
    expect((await cron()).status).toBe(401);
    expect((await cron('wrong')).status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('runs with the right token and answers counts only', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      await user('ann');
      const res = await cron('cron-secret');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        reminders: { people: 0, sent: 0, capped: false, emailed: 0 },
        nudges: { emailed: 1, capped: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sendBirthdayNudgeEmails', () => {
  it('emails three weeks ahead with the countdown, and nobody outside the window', async () => {
    await user('ann');
    await user('far', { birthday: '2000-10-28' }); // 22 days
    await user('near', { birthday: '2000-10-20' }); // 14 days: past the catch-up
    await user('none', { birthday: null });

    expect(await sendBirthdayNudgeEmails(NOW)).toEqual({ emailed: 1, capped: false });
    expect(emailed()).toEqual(['ann@x.com']);
    expect(sendEmail.mock.calls[0]![1]).toEqual({
      recipientId: expect.any(String),
      days: 21,
    });
  });

  it('catches up for two days after a missed run, saying the real countdown', async () => {
    await user('ann');
    expect((await sendBirthdayNudgeEmails(new Date('2026-10-08T06:30:00Z'))).emailed).toBe(1);
    expect(sendEmail.mock.calls[0]![1].days).toBe(19);
    expect((await sendBirthdayNudgeEmails(new Date('2026-10-09T06:30:00Z'))).emailed).toBe(0);
  });

  it('counts from the UTC date', async () => {
    await user('ann');
    // Oct 5, 23:30 UTC: 22 days to go in UTC, whatever the server's zone.
    expect((await sendBirthdayNudgeEmails(new Date('2026-10-05T23:30:00Z'))).emailed).toBe(0);
  });

  it('emails a Feb 29 birthday on the right day in a year without one', async () => {
    await user('leap', { birthday: '2000-02-29' });
    expect((await sendBirthdayNudgeEmails(new Date('2027-02-07T06:30:00Z'))).emailed).toBe(1);
  });

  it('sends once a year, however many runs, and again next year', async () => {
    const ann = await user('ann');
    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(1);
    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(0);
    expect((await sendBirthdayNudgeEmails(new Date('2026-10-07T06:30:00Z'))).emailed).toBe(0);
    const claims = await NotificationEmailClaim.find({ user: ann }).lean();
    expect(claims.map((c) => [c.kind, c.key, c.wishlist])).toEqual([
      ['birthday_nudge', '2026', undefined],
    ]);

    expect((await sendBirthdayNudgeEmails(new Date('2027-10-06T06:30:00Z'))).emailed).toBe(1);
  });

  it('sends once when two runs overlap', async () => {
    await user('ann');
    const runs = await Promise.all([sendBirthdayNudgeEmails(NOW), sendBirthdayNudgeEmails(NOW)]);
    expect(runs.reduce((n, r) => n + r.emailed, 0)).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('the claim index lets one claim per person and year through', async () => {
    const ann = await user('ann');
    const claims = await Promise.all([
      claimBirthdayNudgeEmail(ann, '2026-10-27', NOW),
      claimBirthdayNudgeEmail(ann, '2026-10-30', NOW),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimBirthdayNudgeEmail(ann, '2027-10-27', NOW)).not.toBeNull();
  });

  it('skips anyone who turned the email off', async () => {
    await user('ann', { notificationPrefs: { birthday_nudge: { email: false } } });
    await user('bo', { notificationPrefs: { birthday_nudge: { email: true } } });
    await sendBirthdayNudgeEmails(NOW);
    expect(emailed()).toEqual(['bo@x.com']);
  });

  it('skips anyone with a Birthday list coming, owned alone or co-owned', async () => {
    const ann = await user('ann');
    const bo = await user('bo');
    await user('cy');
    const other = await user('other', { birthday: null });
    await list([ann], birthdayOn('2026-10-31')); // a party a few days after
    await list([other, bo], birthdayOn('2026-10-25')); // co-owned
    // Someone else's Birthday list says nothing about Cy's birthday.
    await list([other], birthdayOn('2026-10-27'));
    await sendBirthdayNudgeEmails(NOW);
    expect(emailed()).toEqual(['cy@x.com']);
  });

  it('emails anyway when the only Birthday lists are archived, passed or not birthdays', async () => {
    const ann = await user('ann');
    await list([ann], birthdayOn('2026-10-27'), { archived: true });
    await list([ann], birthdayOn('2025-10-27'));
    await list([ann], { kind: 'wedding', date: '2026-10-27', recurrence: null });
    await sendBirthdayNudgeEmails(NOW);
    expect(emailed()).toEqual(['ann@x.com']);
  });

  it('re-checks after the claim: a Birthday list made meanwhile gives the claim back', async () => {
    const ann = await user('ann');
    const create = NotificationEmailClaim.create.bind(NotificationEmailClaim);
    vi.spyOn(NotificationEmailClaim, 'create').mockImplementationOnce((async (doc: unknown) => {
      const row = await create(doc as never);
      await list([ann], birthdayOn('2026-10-27'));
      return row;
    }) as never);

    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(0);
  });

  it('re-checks after the claim: an email turned off or a birthday moved meanwhile sends nothing', async () => {
    const ann = await user('ann');
    const bo = await user('bo');
    const create = NotificationEmailClaim.create.bind(NotificationEmailClaim);
    vi.spyOn(NotificationEmailClaim, 'create').mockImplementation((async (doc: {
      user: Types.ObjectId;
    }) => {
      const row = await create(doc as never);
      if (String(doc.user) === String(ann)) {
        await User.updateOne({ _id: ann }, { 'notificationPrefs.birthday_nudge.email': false });
      } else {
        await User.updateOne({ _id: bo }, { birthday: '2000-12-01' });
      }
      return row;
    }) as never);

    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
  });

  it('a failed send gives the claim back, and the next run tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await user('ann');
    sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(0);
    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(1);
  });

  it('a limited send gives the claim back', async () => {
    const limit = vi.fn<RateLimiter['limit']>();
    limit.mockResolvedValue({ success: false, reset: Date.now() + 60_000, limit: 1, remaining: 0 });
    __setRateLimiters({ emailBirthdayNudge: { limit } });
    await user('ann');
    expect((await sendBirthdayNudgeEmails(NOW)).emailed).toBe(0);
    expect(await NotificationEmailClaim.countDocuments()).toBe(0);
  });

  it('stops at the cap, nearest birthday first; the rest go out on the next run', async () => {
    expect(BIRTHDAY_NUDGE_MAX_PER_RUN).toBe(50);
    await user('a21');
    await user('b19', { birthday: '2000-10-25' });
    await user('c20', { birthday: '2000-10-26' });
    expect(await sendBirthdayNudgeEmails(NOW, 2)).toEqual({ emailed: 2, capped: true });
    expect(emailed()).toEqual(['b19@x.com', 'c20@x.com']);
    expect(await sendBirthdayNudgeEmails(NOW, 2)).toEqual({ emailed: 1, capped: false });
    expect(emailed()).toEqual(['b19@x.com', 'c20@x.com', 'a21@x.com']);
  });

  it('starts nothing past its deadline (its share of the birthday cron), and carries it over', async () => {
    await user('ann');
    expect(await sendBirthdayNudgeEmails(NOW, undefined, Date.now() - 1)).toEqual({
      emailed: 0,
      capped: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await sendBirthdayNudgeEmails(NOW)).toEqual({ emailed: 1, capped: false });
  });
});

it('deleting an account removes its birthday nudge claims', async () => {
  const ann = await user('ann');
  const bo = await user('bo');
  await sendBirthdayNudgeEmails(NOW);
  expect(await NotificationEmailClaim.countDocuments({ kind: 'birthday_nudge' })).toBe(2);
  expect(await deleteAccount(String(ann), { agreedListIds: [] })).toBe('deleted');
  expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(0);
  expect(await NotificationEmailClaim.countDocuments({ user: bo })).toBe(1);
});
