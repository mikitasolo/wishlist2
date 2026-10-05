import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { POST as inviteMember } from '@/app/api/wishlists/[id]/members/route';
import { POST as promoteToOwner } from '@/app/api/wishlists/[id]/owners/[userId]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';

/**
 * The name an invite gives its sender. Both invite doors (inviting by username,
 * promoting a member) email the invitee, who is another user, so no part of the
 * inviter's email address may end up in it.
 */

const session = vi.mocked(auth);

const INVITER_EMAIL = 'jane.doe@example.com';
const WISHLIST_NAME = 'Family list';

let inviterId: string;
let friendId: string;
let memberId: string;
let wishlistId: string;

/** Sign in as the inviter, with whatever public fields their session carries. */
function asInviter(fields: { username?: string; name?: string | null } = {}) {
  session.mockResolvedValue({ user: { id: inviterId, email: INVITER_EMAIL, ...fields } } as never);
}

function post(url: string, body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const doors = [
  {
    door: 'inviting by username',
    status: 201,
    role: 'member',
    inviteeEmail: 'friend@x.com',
    inviteeId: () => friendId,
    send: () =>
      inviteMember(post(`/api/wishlists/${wishlistId}/members`, { username: 'friend' }), {
        params: Promise.resolve({ id: wishlistId }),
      }),
  },
  {
    door: 'promoting a member',
    status: 202,
    role: 'owner',
    inviteeEmail: 'carol@x.com',
    inviteeId: () => memberId,
    send: () =>
      promoteToOwner(post(`/api/wishlists/${wishlistId}/owners/${memberId}`), {
        params: Promise.resolve({ id: wishlistId, userId: memberId }),
      }),
  },
];

function expectNoPartOfTheEmail(name: string) {
  for (const part of ['@', 'jane', 'doe', 'example']) {
    expect(name.toLowerCase()).not.toContain(part);
  }
}

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();

  // A legacy account that predates usernames, so it has none.
  inviterId = (await User.create({ email: INVITER_EMAIL }))._id.toString();
  friendId = (await User.create({ email: 'friend@x.com', username: 'friend' }))._id.toString();
  memberId = (await User.create({ email: 'carol@x.com', username: 'carol' }))._id.toString();

  const wl = await Wishlist.create({
    name: WISHLIST_NAME,
    owners: [inviterId],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wishlistId, user: memberId });
});

describe.each(doors)(
  'the inviter named in an invite, $door',
  ({ status, role, inviteeEmail, inviteeId, send }) => {
    /** What the invite email is handed: the inviter's names, never the list's in a subject. */
    const emailed = (inviterName: string, inviterUsername: string | null) => [
      inviteeEmail,
      {
        recipientId: inviteeId(),
        wishlistName: WISHLIST_NAME,
        role,
        inviterName,
        inviterUsername,
      },
    ];

    // regression: both invite routes fell back to `session.user.email.split('@')[0]`
    // for an inviter without a username, so the invitee was emailed the local part
    // of the inviter's address ("jane.doe invited you…").
    it('regression: an inviter with no username is "Someone", with no part of their email', async () => {
      asInviter();
      expect((await send()).status).toBe(status);

      expect(sendEmail).toHaveBeenCalledOnce();
      expect(sendEmail).toHaveBeenCalledWith(...emailed('Someone', null));
      expectNoPartOfTheEmail(sendEmail.mock.calls[0][1].inviterName as string);
    });

    it('keeps the in-app notification anonymous for an inviter with no username', async () => {
      asInviter();
      expect((await send()).status).toBe(status);

      const notification = await Notification.findOne({
        user: inviteeId(),
        type: 'wishlist_invite',
      });
      expect(notification?.actorUsername).toBeNull();
    });

    it("falls back to the inviter's name before the neutral one", async () => {
      asInviter({ name: 'Aunt Jo' });
      expect((await send()).status).toBe(status);
      expect(sendEmail).toHaveBeenCalledWith(...emailed('Aunt Jo', null));
    });

    it('names the inviter by their username when they have one', async () => {
      asInviter({ username: 'auntjo', name: 'Aunt Jo' });
      expect((await send()).status).toBe(status);
      expect(sendEmail).toHaveBeenCalledWith(...emailed('auntjo', 'auntjo'));
    });
  }
);
