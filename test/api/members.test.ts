import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { POST } from '@/app/api/wishlists/[id]/members/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

let ownerId: string;
let friendId: string;
let wishlistId: string;

beforeAll(async () => {
  await connectTestDB();
  // The race tests rely on the unique pending-invite index: wait for autoIndex.
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  ownerId = owner._id.toString();
  friendId = (await User.create({ email: 'friend@x.com', username: 'friend' }))._id.toString();
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'everyone' });
  wishlistId = wl._id.toString();
});

function invite(id: string, body: unknown, userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
  const req = new NextRequest('http://localhost/api/wishlists/' + id + '/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/wishlists/[id]/members — invites', () => {
  it('owner invites an existing user by username → pending invite + email', async () => {
    const res = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(res.status).toBe(201);
    const inv = await WishlistInvite.findOne({ wishlist: wishlistId });
    expect(inv?.status).toBe('pending');
    expect(inv?.role).toBe('member');
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  // Regression: invites are registered-users-only. An email is not a valid target.
  it('regression: rejects an email-only invite (no username)', async () => {
    const res = await invite(wishlistId, { email: 'stranger@x.com' }, ownerId);
    expect(res.status).toBe(400);
    expect(await WishlistInvite.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s for an unknown username', async () => {
    const res = await invite(wishlistId, { username: 'ghost' }, ownerId);
    expect(res.status).toBe(404);
  });

  it('non-owner / non-admin cannot invite', async () => {
    const stranger = await User.create({ email: 's@x.com', username: 'stranger' });
    const res = await invite(wishlistId, { username: 'friend' }, stranger._id.toString());
    expect(res.status).toBe(403);
  });

  it("respects the invitee's whoCanInvite = nobody", async () => {
    await User.create({
      email: 'shy@x.com',
      username: 'shy',
      privacy: { whoCanInvite: 'nobody' },
    });
    const res = await invite(wishlistId, { username: 'shy' }, ownerId);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/wishlists/[id]/members — one pending invite per person', () => {
  const pendingInvites = () =>
    WishlistInvite.countDocuments({
      wishlist: wishlistId,
      invitedUser: friendId,
      status: 'pending',
    });
  const inviteNotifications = () =>
    Notification.countDocuments({ user: friendId, type: 'wishlist_invite' });

  it('refuses a second invite while one is pending, and sends nothing for it', async () => {
    expect((await invite(wishlistId, { username: 'friend' }, ownerId)).status).toBe(201);
    const again = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/pending invite/i);
    expect(await pendingInvites()).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(await inviteNotifications()).toBe(1);
  });

  it('two concurrent invites to the same person leave one invite, one email, one notification', async () => {
    const results = await Promise.all([
      invite(wishlistId, { username: 'friend' }, ownerId),
      invite(wishlistId, { username: 'friend' }, ownerId),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await pendingInvites()).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(await inviteNotifications()).toBe(1);
  });

  // regression: the "already pending?" check and the insert were separate steps
  // with no unique index behind them, so two requests could both pass the check
  // and both insert. The index now refuses the second insert, and the request
  // that lost must send nothing.
  it('regression: losing the race past the pending check is answered as already pending', async () => {
    await WishlistInvite.create({
      wishlist: wishlistId,
      invitedBy: ownerId,
      invitedUser: friendId,
    });
    // The other request inserts between this one's check and its insert.
    vi.spyOn(WishlistInvite, 'findOne').mockResolvedValueOnce(null as never);

    const res = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pending invite/i);
    expect(await pendingInvites()).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await inviteNotifications()).toBe(0);
  });

  it('still fails on an insert error that is not a duplicate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(WishlistInvite, 'create').mockRejectedValueOnce(new Error('db down') as never);

    const res = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(res.status).toBe(500);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await inviteNotifications()).toBe(0);
  });

  // regression: the email went out before the notification and its error was
  // rethrown, so a failed send left the invite in place with no bell
  // notification, answered 500, and made the retry fail as "already pending".
  it('regression: a failed invite email keeps the invite and its notification, and succeeds', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error("Can't send mail - all recipients were rejected: <friend@x.com>"), {
        code: 'EENVELOPE',
        responseCode: 550,
      })
    );

    const res = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe('pending');
    expect(await pendingInvites()).toBe(1);
    expect(await inviteNotifications()).toBe(1);

    // The failure is logged here, without the address the SMTP error quoted.
    expect(logged).toHaveBeenCalled();
    const log = JSON.stringify(logged.mock.calls);
    expect(log).toContain('EENVELOPE');
    expect(log).not.toContain('friend@x.com');
  });

  it('can re-invite someone who declined', async () => {
    expect((await invite(wishlistId, { username: 'friend' }, ownerId)).status).toBe(201);
    const first = await WishlistInvite.findOne({ invitedUser: friendId });
    const inviteId = first!._id.toString();
    session.mockResolvedValue({ user: { id: friendId } } as never);
    const declined = await respondInvite(
      new NextRequest('http://localhost/api/invites/' + inviteId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'decline' }),
      }),
      { params: Promise.resolve({ inviteId }) }
    );
    expect(declined.status).toBe(200);

    const again = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(again.status).toBe(201);
    const rows = await WishlistInvite.find({ invitedUser: friendId }).sort({ _id: 1 });
    expect(rows.map((r) => r.status)).toEqual(['declined', 'pending']);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
