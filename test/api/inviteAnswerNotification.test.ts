import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH as answerInvite } from '@/app/api/invites/[inviteId]/route';
import { GET as getFeed } from '@/app/api/notifications/route';
import { issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import {
  notificationLink,
  notificationText,
  type NotificationView,
} from '@/lib/utils/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite, { type IWishlistInvite } from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

const usernames = new Map<string, string>(); // id -> username
function as(id: string) {
  session.mockResolvedValue({ user: { id, username: usernames.get(id) } } as never);
}

async function makeUser(username: string): Promise<string> {
  const id = (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  usernames.set(id, username);
  return id;
}

let ben: string; // owns the list and invites
let anna: string; // the invitee
let cara: string; // invited to the same list too
let listId: string;

/** Invite through the one path that issues invites: the invite, then its notification. */
async function invite(userId: string, list = listId, role: IWishlistInvite['role'] = 'member') {
  const issued = await issueWishlistInvite({
    wishlistId: list,
    wishlistName: list === listId ? 'Ben’s housewarming' : 'Other list',
    role,
    invitedBy: ben,
    inviterName: 'ben',
    actorUsername: 'ben',
    invitedUserId: userId,
  });
  if (!issued || issued === 'capped') throw new Error('invite not issued');
  return issued._id.toString();
}

function answer(inviteId: string, action: 'accept' | 'decline', userId = anna) {
  as(userId);
  return answerInvite(
    new NextRequest(`http://localhost/api/invites/${inviteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ inviteId }) }
  );
}

async function feedOf(userId: string): Promise<{ rows: NotificationView[]; unread: number }> {
  as(userId);
  const res = await getFeed(new NextRequest('http://localhost/api/notifications'));
  expect(res.status).toBe(200);
  const json = await res.json();
  return { rows: json.data, unread: json.unreadCount };
}

/** How a row reads and where it leads, as the feed shows it to `viewer`. */
const shown = (n: NotificationView, viewer = 'anna') => ({
  text: notificationText(n),
  href: notificationLink(n, viewer),
  read: n.read,
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  usernames.clear();
  ben = await makeUser('ben');
  anna = await makeUser('anna');
  cara = await makeUser('cara');
  listId = (
    await Wishlist.create({ name: 'Ben’s housewarming', owners: [ben], visibility: 'private' })
  )._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answering an invite updates its notification', () => {
  it('reads as a pending invite, linking nowhere (its card in Activity answers it), before it is answered', async () => {
    await invite(anna);

    const { rows, unread } = await feedOf(anna);

    expect(rows.map((n) => shown(n))).toEqual([
      { text: '@ben invited you to Ben’s housewarming', href: null, read: false },
    ]);
    expect(rows[0].inviteAnswer).toBeNull();
    expect(unread).toBe(1);
  });

  // regression: answering never touched the invitee's `wishlist_invite`
  // notification, so it went on saying "@ben invited you to …", linked to an
  // Invitations page that no longer had the invite (Activity now), and the bell kept counting it.
  it('regression: accepting marks it read, and it reads "You joined …" linking to the list', async () => {
    const id = await invite(anna);

    expect((await answer(id, 'accept')).status).toBe(200);

    const { rows, unread } = await feedOf(anna);
    expect(rows.map((n) => shown(n))).toEqual([
      { text: 'You joined Ben’s housewarming', href: `/wishlists/${listId}`, read: true },
    ]);
    expect(rows[0].inviteAnswer).toBe('accepted');
    expect(unread).toBe(0);
  });

  it('regression: declining marks it read, and it reads "You declined …" with no link', async () => {
    const id = await invite(anna);

    expect((await answer(id, 'decline')).status).toBe(200);

    const { rows, unread } = await feedOf(anna);
    expect(rows.map((n) => shown(n))).toEqual([
      { text: 'You declined the invite to Ben’s housewarming', href: null, read: true },
    ]);
    expect(rows[0].inviteAnswer).toBe('declined');
    expect(unread).toBe(0);
  });

  // Every way accept grants a role ends the same way.
  it.each([
    ['an owner invite to a newcomer', false],
    ['a promotion of a member', true],
  ])('records the answer when accepting %s', async (_, isMember) => {
    if (isMember) await WishlistMember.create({ wishlist: listId, user: anna });
    const id = await invite(anna, listId, 'owner');

    expect((await answer(id, 'accept')).status).toBe(200);

    const { rows } = await feedOf(anna);
    expect(rows.map((n) => shown(n))).toEqual([
      { text: 'You joined Ben’s housewarming', href: `/wishlists/${listId}`, read: true },
    ]);
  });

  it("leaves everyone else's notifications, and the invitee's others, as they were", async () => {
    const otherList = (
      await Wishlist.create({ name: 'Other list', owners: [ben], visibility: 'everyone' })
    )._id;
    const id = await invite(anna);
    await invite(cara);
    await invite(anna, otherList.toString());
    await Notification.create({ user: anna, type: 'follow', actorUsername: 'cara' });

    expect((await answer(id, 'accept')).status).toBe(200);

    // Cara's invite to the same list still waits for her.
    const cara_ = await feedOf(cara);
    expect(cara_.rows.map((n) => shown(n, 'cara'))).toEqual([
      { text: '@ben invited you to Ben’s housewarming', href: null, read: false },
    ]);
    // Ben hears about the accept, unread.
    const ben_ = await feedOf(ben);
    expect(ben_.rows.map((n) => shown(n, 'ben'))).toEqual([
      {
        text: '@anna accepted your invitation to Ben’s housewarming',
        href: expect.any(String),
        read: false,
      },
    ]);
    // Only the answered invite changed among Anna's own.
    const anna_ = await feedOf(anna);
    expect(anna_.rows.map((n) => shown(n)).sort((a, b) => a.text.localeCompare(b.text))).toEqual([
      { text: '@ben invited you to Other list', href: null, read: false },
      { text: '@cara followed you', href: '/users/cara', read: false },
      { text: 'You joined Ben’s housewarming', href: `/wishlists/${listId}`, read: true },
    ]);
    expect(anna_.unread).toBe(2);
  });

  // Notifications carry no invite id. One from an earlier invite to the same list
  // (answered before answers were recorded) is older than this invite, so it
  // isn't taken for this one's.
  it("doesn't relabel an earlier invite's notification for the same list", async () => {
    const earlier = await Notification.create({
      user: anna,
      type: 'wishlist_invite',
      actorUsername: 'ben',
      wishlist: listId,
      wishlistName: 'Ben’s housewarming',
    });
    await Notification.collection.updateOne(
      { _id: earlier._id },
      { $set: { createdAt: new Date(Date.now() - 60_000) } }
    );
    const id = await invite(anna);

    expect((await answer(id, 'decline')).status).toBe(200);

    const left = await Notification.findById(earlier._id).lean();
    expect(left?.read).toBe(false);
    expect(left?.inviteAnswer).toBeUndefined();
  });

  // Declining frees the list for a new invite at once. One issued right after the
  // claim, before the answer reaches the notifications, is newer than the answer
  // and stays a pending invite.
  it("leaves a re-invite's notification pending when it lands mid-decline", async () => {
    const id = await invite(anna);
    let reinvite = '';
    const race = holdFirstCall(
      WishlistInvite,
      'updateOne',
      async () => {
        await pause(5);
        reinvite = await invite(anna);
      },
      { after: true }
    );

    expect((await answer(id, 'decline')).status).toBe(200);
    race.restore();

    expect(race.held()).toBe(true);
    expect((await WishlistInvite.findById(reinvite))?.status).toBe('pending');
    const { rows, unread } = await feedOf(anna);
    expect(rows.map((n) => shown(n))).toEqual([
      { text: '@ben invited you to Ben’s housewarming', href: null, read: false },
      { text: 'You declined the invite to Ben’s housewarming', href: null, read: true },
    ]);
    expect(unread).toBe(1);
  });

  it.each(['accept', 'decline'] as const)(
    'still answers the %s when recording it on the notification fails',
    async (action) => {
      const id = await invite(anna);
      vi.spyOn(Notification, 'updateMany').mockRejectedValueOnce(
        Object.assign(new Error(`E11000 dup key: { user: "${anna}" }`), { code: 11000 })
      );
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await answer(id, action);

      expect(res.status).toBe(200);
      expect((await WishlistInvite.findById(id))?.status).toBe(
        action === 'accept' ? 'accepted' : 'declined'
      );
      // The notification is left as it was.
      const [row] = (await feedOf(anna)).rows;
      expect(shown(row).read).toBe(false);
      expect(row.inviteAnswer).toBeNull();
      // Logged by its kind only: nothing about who answered which invite.
      expect(log).toHaveBeenCalledWith('Failed to record an invite answer on its notification:', {
        name: 'Error',
        code: 11000,
      });
      for (const line of log.mock.calls) {
        expect(JSON.stringify(line)).not.toMatch(new RegExp(`${anna}|${listId}|${id}|@x\\.com`));
      }
    }
  );

  // A failed grant reopens the invite, which is then pending again: its
  // notification must still read as one.
  it('leaves the notification pending when the accept fails to grant the role', async () => {
    const id = await invite(anna);
    vi.spyOn(WishlistMember, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db hiccup'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await answer(id, 'accept')).status).toBe(500);

    expect((await WishlistInvite.findById(id))?.status).toBe('pending');
    const { rows, unread } = await feedOf(anna);
    expect(rows.map((n) => shown(n))).toEqual([
      { text: '@ben invited you to Ben’s housewarming', href: null, read: false },
    ]);
    expect(unread).toBe(1);
  });

  it("doesn't touch the notification when someone else's answer is refused", async () => {
    const id = await invite(anna);

    expect((await answer(id, 'decline', cara)).status).toBe(404);

    const [row] = (await feedOf(anna)).rows;
    expect(shown(row)).toEqual({
      text: '@ben invited you to Ben’s housewarming',
      href: null,
      read: false,
    });
  });
});

// Activity shows who did it by the account each row recorded, never by the
// username it reads with, which can change hands.
describe('who an invite’s notifications are from', () => {
  it('records the inviter on the invite, and the invitee on its acceptance', async () => {
    const id = await invite(anna);
    const [invited] = await Notification.find({ user: anna, type: 'wishlist_invite' }).lean();
    expect(invited.actor?.toString()).toBe(ben);

    expect((await answer(id, 'accept')).status).toBe(200);
    const [accepted] = await Notification.find({ user: ben, type: 'invite_accepted' }).lean();
    expect(accepted.actor?.toString()).toBe(anna);
  });
});
