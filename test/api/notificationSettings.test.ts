import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { POST as invite } from '@/app/api/wishlists/[id]/members/route';
import { createNotification, createNotifications, recipientsWanting } from '@/lib/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import type { NotificationPrefs } from '@/lib/utils/notificationPrefs';

// Settings → Notifications (WIS-321): each event's in-app switch decides
// whether its rows are written, and the invite email follows its email switch
// (on by default, as it always was).

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendWishlistInvitationEmail);

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
});

async function user(username: string, notificationPrefs?: NotificationPrefs) {
  return String(
    (await User.create({ email: `${username}@x.com`, username, notificationPrefs }))._id
  );
}

describe('in-app switches', () => {
  it('writes no row for someone who turned that event off in app', async () => {
    const off = await user('off', { invite_accepted: { inApp: false } });
    const on = await user('on');

    expect(await createNotification({ user: off, type: 'invite_accepted' })).toBeNull();
    expect(await createNotification({ user: on, type: 'invite_accepted' })).not.toBeNull();
    expect(await Notification.countDocuments({ user: off })).toBe(0);
    expect(await Notification.countDocuments({ user: on })).toBe(1);
  });

  it('only that event: their other notifications still arrive', async () => {
    const off = await user('off', { invite_accepted: { inApp: false } });
    expect(await createNotification({ user: off, type: 'proposal_approved' })).not.toBeNull();
  });

  it('one switch covers both access changes, demotion and removal', async () => {
    const off = await user('off', { access_changed: { inApp: false } });
    await createNotification({ user: off, type: 'role_changed' });
    await createNotification({ user: off, type: 'removed_from_wishlist' });
    expect(await Notification.countDocuments({ user: off })).toBe(0);
  });

  it('skips only the owners who turned it off in a fan-out', async () => {
    const a = await user('a');
    const b = await user('b', { join_request: { inApp: false } });
    const list = await Wishlist.create({ name: 'L', owners: [a, b], visibility: 'everyone' });

    const ids = await createNotifications([a, b], {
      type: 'join_request',
      actorUsername: 'zed',
      wishlist: list._id,
      wishlistName: 'L',
    });
    expect(ids).toHaveLength(1);
    expect(await Notification.countDocuments({ user: a })).toBe(1);
    expect(await Notification.countDocuments({ user: b })).toBe(0);
  });

  it('turns off follow rows too', async () => {
    const off = await user('off', { follow: { inApp: false } });
    await createNotification({ user: off, type: 'follow', actorUsername: 'zed' });
    expect(await Notification.countDocuments({ user: off })).toBe(0);
  });
});

describe('recipientsWanting', () => {
  it('on by default: everyone but those who turned it off, in order', async () => {
    const a = await user('a');
    const b = await user('b', { proposal: { email: false } });
    const c = await user('c', { proposal: { email: true } });
    expect(await recipientsWanting([c, b, a], 'proposal', 'email')).toEqual([c, a]);
  });

  it('off by default: only those who turned it on', async () => {
    const a = await user('a');
    const b = await user('b', { invite_accepted: { email: true } });
    expect(await recipientsWanting([a, b], 'invite_accepted', 'email')).toEqual([b]);
  });

  it('nobody on a channel the event is not offered on', async () => {
    const a = await user('a');
    expect(await recipientsWanting([a], 'follow', 'email')).toEqual([]);
  });
});

describe('the invitation email', () => {
  let alice: string;
  let wid: string;

  beforeEach(async () => {
    alice = await user('alice');
    wid = String(
      (await Wishlist.create({ name: 'Family list', owners: [alice], visibility: 'everyone' }))._id
    );
    session.mockResolvedValue({ user: { id: alice } } as never);
  });

  const inviteByName = (username: string) =>
    invite(
      new NextRequest(`http://localhost/api/wishlists/${wid}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      }),
      { params: Promise.resolve({ id: wid }) }
    );

  it('is sent by default, with the invitee as its unsubscribe target', async () => {
    const erin = await user('erin');
    expect((await inviteByName('erin')).status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![1]).toMatchObject({ recipientId: erin });
  });

  it('is not sent to someone who turned invitation emails off; the invite and its row still are', async () => {
    const erin = await user('erin', { wishlist_invite: { email: false } });
    expect((await inviteByName('erin')).status).toBe(201);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await WishlistInvite.countDocuments({ invitedUser: erin, status: 'pending' })).toBe(1);
    expect(await Notification.countDocuments({ user: erin, type: 'wishlist_invite' })).toBe(1);
  });

  it('is still sent to someone who turned only the in-app row off', async () => {
    const erin = await user('erin', { wishlist_invite: { inApp: false } });
    expect((await inviteByName('erin')).status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await Notification.countDocuments({ user: erin })).toBe(0);
    expect(await WishlistInvite.countDocuments({ invitedUser: erin, status: 'pending' })).toBe(1);
  });
});
