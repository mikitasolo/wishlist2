import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: vi.fn(),
  sendWishlistInvitationEmail: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { sendNotificationEmail } from '@/lib/email';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { POST as ask } from '@/app/api/wishlists/[id]/requests/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { createNotification, createNotifications } from '@/lib/notifications';
import { claimProposalEmail, PROPOSAL_EMAIL_WINDOW_MS } from '@/lib/notificationEmails';
import { sendOccasionReminders } from '@/lib/utils/occasionReminders';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import type { NotificationPrefs } from '@/lib/utils/notificationPrefs';

// Notification emails (WIS-321): sent beside the in-app rows, each by its own
// setting, never saying more than the row, coalesced for proposals, limited
// per recipient, and once per occurrence for occasion reminders.

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendNotificationEmail);

let ann: string; // owner
let bo: string; // co-owner
let wid: string;

beforeAll(async () => {
  await connectTestDB();
  await NotificationEmailClaim.init();
  await Notification.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  ann = await user('ann');
  bo = await user('bo');
  wid = String(
    (
      await Wishlist.create({
        name: 'Ann’s 30th',
        slug: 'ann-30',
        owners: [ann, bo],
        visibility: 'everyone',
      })
    )._id
  );
});
afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function user(username: string, notificationPrefs?: NotificationPrefs) {
  return String(
    (await User.create({ email: `${username}@x.com`, username, notificationPrefs }))._id
  );
}

/** Who was emailed (by address) about which type, in send order. */
const emailed = () => sendEmail.mock.calls.map(([to, d]) => `${to} ${d.type}`);

const proposal = (owners = [ann, bo]) =>
  createNotifications(owners, {
    type: 'proposal',
    wishlist: wid,
    wishlistName: 'Ann’s 30th',
    wishlistSlug: 'ann-30',
    itemName: 'Mug',
    actorUsername: 'secret_member',
  });

describe('who gets an email', () => {
  it('a request to join emails every owner, on by default, naming the requester', async () => {
    const ivan = await user('ivan');
    session.mockResolvedValue({ user: { id: ivan, username: 'ivan' } } as never);

    const res = await ask(
      new NextRequest(`http://localhost/api/wishlists/${wid}/requests`, { method: 'POST' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBeLessThan(300);

    expect(emailed().sort()).toEqual(['ann@x.com join_request', 'bo@x.com join_request']);
    expect(sendEmail.mock.calls[0]![1]).toMatchObject({
      actorUsername: 'ivan',
      wishlistId: wid,
      wishlistName: 'Ann’s 30th',
    });
  });

  it('not to an owner who turned that email off, who still gets the row', async () => {
    await User.updateOne({ _id: bo }, { 'notificationPrefs.join_request.email': false });
    await createNotifications([ann, bo], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: wid,
      wishlistName: 'L',
    });
    expect(emailed()).toEqual(['ann@x.com join_request']);
    expect(await Notification.countDocuments({ user: bo })).toBe(1);
  });

  it('the email follows its own setting: in app off, email on, still emailed', async () => {
    await User.updateOne({ _id: ann }, { 'notificationPrefs.join_request.inApp': false });
    await createNotifications([ann], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: wid,
      wishlistName: 'L',
    });
    expect(emailed()).toEqual(['ann@x.com join_request']);
    expect(await Notification.countDocuments({ user: ann })).toBe(0);
  });

  it('access changes, accepted invites and approved proposals are off by default', async () => {
    for (const type of [
      'role_changed',
      'removed_from_wishlist',
      'invite_accepted',
      'proposal_approved',
    ] as const) {
      await createNotification({ user: ann, type, wishlist: wid, wishlistName: 'L' });
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a kicked member who turned access emails on is told, never by whom', async () => {
    const mia = await user('mia', { access_changed: { email: true } });
    const membership = await WishlistMember.create({ wishlist: wid, user: mia });
    session.mockResolvedValue({ user: { id: ann, username: 'ann' } } as never);

    const res = await kick(
      new NextRequest(`http://localhost/api/wishlists/${wid}/members/${membership._id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: wid, memberId: String(membership._id) }) }
    );
    expect(res.status).toBe(200);

    expect(emailed()).toEqual(['mia@x.com removed_from_wishlist']);
    const details = sendEmail.mock.calls[0]![1];
    expect(details.actorUsername ?? null).toBeNull();
    expect(JSON.stringify(details)).not.toContain('ann');
  });

  it('nothing for a follow, and an invite only through its own email', async () => {
    await createNotification({ user: ann, type: 'follow', actorUsername: 'ivan' });
    await createNotification({ user: ann, type: 'wishlist_invite', wishlist: wid });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('nothing about a list deleted before the re-check', async () => {
    await createNotifications([ann], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: new Types.ObjectId(),
      wishlistName: 'Gone',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // regression: a failed settings read fell back to the default, "everyone",
  // for the email channel too, so a transient error emailed people who had
  // unsubscribed.
  it('regression: a failed read of the email setting emails nobody', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await User.updateOne({ _id: bo }, { 'notificationPrefs.join_request.email': false });
    const find = User.find.bind(User);
    vi.spyOn(User, 'find').mockImplementation(((filter: Record<string, unknown>) => {
      if (Object.keys(filter ?? {}).some((k) => k.endsWith('.email'))) {
        throw new Error('transient');
      }
      return find(filter);
    }) as never);

    await createNotifications([ann, bo], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: wid,
      wishlistName: 'L',
    });
    expect(sendEmail).not.toHaveBeenCalled();
    // The rows still go out by their own, in-app, setting.
    expect(await Notification.countDocuments({ type: 'join_request' })).toBe(2);
  });

  // regression: the email went out inside `createNotifications`, before the
  // join-request route's re-check, so a request cancelled while its rows were
  // written still emailed every owner.
  it('regression: no email for an event taken back while its rows were written', async () => {
    await createNotifications(
      [ann],
      { type: 'join_request', actorUsername: 'ivan', wishlist: wid, wishlistName: 'L' },
      { stillHolds: async () => false }
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a failed send never fails the notification', async () => {
    sendEmail.mockRejectedValue(new Error('SMTP down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ids = await createNotifications([ann], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: wid,
      wishlistName: 'L',
    });
    expect(ids).toHaveLength(1);
  });
});

describe('proposal emails: at most one per list per owner a day', () => {
  it('a burst of proposals emails each owner once, never naming the proposer', async () => {
    await proposal();
    await proposal();
    await proposal();
    expect(emailed().sort()).toEqual(['ann@x.com proposal', 'bo@x.com proposal']);
    for (const [, details] of sendEmail.mock.calls) {
      expect(JSON.stringify(details)).not.toContain('secret_member');
    }
  });

  it('another list has its own day', async () => {
    const other = String(
      (await Wishlist.create({ name: 'Other', owners: [ann], visibility: 'everyone' }))._id
    );
    await proposal([ann]);
    await createNotifications([ann], { type: 'proposal', wishlist: other, wishlistName: 'O' });
    expect(emailed()).toEqual(['ann@x.com proposal', 'ann@x.com proposal']);
  });

  it('a day later, the next proposal emails again', async () => {
    const now = new Date();
    expect(await claimProposalEmail(ann, wid, now)).not.toBeNull();
    expect(await claimProposalEmail(ann, wid, new Date(now.getTime() + 60_000))).toBeNull();
    expect(
      await claimProposalEmail(ann, wid, new Date(now.getTime() + PROPOSAL_EMAIL_WINDOW_MS + 1))
    ).not.toBeNull();
  });

  it('racing claims let exactly one through', async () => {
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimProposalEmail(ann, wid)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(1);
  });

  it('a failed send gives its claim back, so the next proposal can email', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    await proposal([ann]);
    expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(0);
    await proposal([ann]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('rate limits', () => {
  const limit = vi.fn<RateLimiter['limit']>();
  beforeEach(() => {
    limit.mockReset();
    limit.mockResolvedValue({ success: false, reset: Date.now() + 60_000, limit: 1, remaining: 0 });
    __setRateLimiters({ emailProposal: { limit }, emailJoinRequest: { limit } });
  });

  it('are counted per recipient, and a limited one is not emailed', async () => {
    await createNotifications([ann], {
      type: 'join_request',
      actorUsername: 'ivan',
      wishlist: wid,
      wishlistName: 'L',
    });
    expect(limit).toHaveBeenCalledWith(ann);
    expect(sendEmail).not.toHaveBeenCalled();
    // The in-app row is unaffected.
    expect(await Notification.countDocuments({ user: ann })).toBe(1);
  });

  it('a limited proposal email gives its claim back', async () => {
    await proposal([ann]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(0);
  });
});

describe('occasion reminder emails', () => {
  // Monday 5 Oct 2026: a week ahead is Monday 12 Oct.
  const NOW = new Date('2026-10-05T06:00:00Z');
  let lid: Types.ObjectId;

  beforeEach(async () => {
    lid = (
      await Wishlist.create({
        name: 'Mia’s birthday',
        slug: 'mia-bday',
        owners: [ann],
        visibility: 'friends',
        occasion: { kind: 'birthday', date: '2026-10-12', recurrence: null },
      })
    )._id;
  });
  const join = async (id: string) => WishlistMember.create({ wishlist: lid, user: id });

  it('emails each member once per occurrence, however many runs', async () => {
    const mia = await user('mia');
    await join(mia);

    expect((await sendOccasionReminders(NOW)).emailed).toBe(1);
    expect((await sendOccasionReminders(NOW)).emailed).toBe(0);
    // The next day, inside the catch-up window: still nothing new.
    expect((await sendOccasionReminders(new Date('2026-10-06T06:00:00Z'))).emailed).toBe(0);
    expect(emailed()).toEqual(['mia@x.com occasion_reminder']);
    expect(sendEmail.mock.calls[0]![1]).toMatchObject({
      occasionKind: 'birthday',
      occasionDate: '2026-10-12',
      wishlistName: 'Mia’s birthday',
    });
  });

  it('overlapping runs send it once', async () => {
    await join(await user('mia'));
    const runs = await Promise.all([sendOccasionReminders(NOW), sendOccasionReminders(NOW)]);
    expect(runs.reduce((n, r) => n + r.emailed, 0)).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('the email and the in-app reminder are switched apart', async () => {
    const noEmail = await user('noemail', { occasion_reminder: { email: false } });
    const noRow = await user('norow', { occasion_reminder: { inApp: false } });
    await join(noEmail);
    await join(noRow);

    await sendOccasionReminders(NOW);
    expect(emailed()).toEqual(['norow@x.com occasion_reminder']);
    const rows = await Notification.find({ type: 'occasion_reminder' }).lean();
    expect(rows.map((r) => String(r.user))).toEqual([noEmail]);
  });

  it('never to an owner, nor for an archived list', async () => {
    await WishlistMember.create({ wishlist: lid, user: ann });
    await sendOccasionReminders(NOW);
    expect(sendEmail).not.toHaveBeenCalled();

    await join(await user('mia'));
    await Wishlist.updateOne({ _id: lid }, { archived: true });
    await sendOccasionReminders(NOW);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a failed send gives the claim back, and the next run tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await join(await user('mia'));
    sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    expect((await sendOccasionReminders(NOW)).emailed).toBe(0);
    expect((await sendOccasionReminders(NOW)).emailed).toBe(1);
  });

  it('stops at its own cap; the rest go out on the next run', async () => {
    for (const name of ['m1', 'm2', 'm3']) await join(await user(name));
    expect((await sendOccasionReminders(NOW, 500, 2)).emailed).toBe(2);
    expect((await sendOccasionReminders(NOW, 500, 2)).emailed).toBe(1);
  });
});

it('deleting an account removes its record of emails sent', async () => {
  await claimProposalEmail(ann, wid);
  await claimProposalEmail(bo, wid);
  // Ann owns the list with Bo, so it's left, not deleted.
  expect(await deleteAccount(ann, { agreedListIds: [] })).toBe('deleted');
  expect(await NotificationEmailClaim.countDocuments({ user: ann })).toBe(0);
  expect(await NotificationEmailClaim.countDocuments({ user: bo })).toBe(1);
});
