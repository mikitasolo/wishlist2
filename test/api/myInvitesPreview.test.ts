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
import { GET as listMyInvites } from '@/app/api/users/me/invites/route';
import { GET as getNotifications } from '@/app/api/notifications/route';
import { issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Follow from '@/models/Follow';

// WIS-273: an invitation card shows what's on the list (banner, occasion, item
// count) only when the invitee could already open it, so an invite reveals
// nothing new about a list they can't see. An owner invite carries the invitee's
// own reservation count there (what accepting releases), and nothing else does.

const session = vi.mocked(auth);

let alice: string; // owner of every list
let ben: string; // the invitee
let carol: string; // another gifter

const OCCASION = { kind: 'holiday', date: '2026-12-26', recurrence: null };

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  ben = await user('ben');
  carol = await user('carol');
});

async function list(visibility: 'everyone' | 'friends' | 'private', archived = false) {
  const wl = await Wishlist.create({
    name: `List ${visibility}`,
    owners: [alice],
    visibility,
    archived,
    bannerUrl: 'https://example.com/banner.jpg',
    occasion: OCCASION,
  });
  // Two published items, a draft and a proposal: "2 items".
  await Item.create([
    { wishlist: wl._id, name: 'A', status: 'available' },
    { wishlist: wl._id, name: 'B', status: 'booked', bookedBy: carol },
    { wishlist: wl._id, name: 'C', status: 'draft' },
    { wishlist: wl._id, name: 'D', status: 'proposed', proposedBy: carol },
  ]);
  return wl._id.toString();
}

const invite = (wishlist: string, role: 'owner' | 'member', invitedUser = ben) =>
  WishlistInvite.create({ wishlist, invitedBy: alice, invitedUser, role });

async function reserve(gifter: string, wishlist: string, n = 1) {
  for (let i = 0; i < n; i++) {
    const item = await Item.create({ wishlist, name: `R${i}`, status: 'booked', bookedBy: gifter });
    await Reservation.create({
      gifter,
      wishlist,
      item: item._id,
      owner: alice,
      itemName: `R${i}`,
      wishlistName: 'List',
    });
  }
}

async function myInvites(userId: string) {
  session.mockResolvedValueOnce({ user: { id: userId } } as never);
  const res = await listMyInvites();
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data as Array<Record<string, unknown> & { wishlistId: string }>;
}
const forList = async (userId: string, wishlistId: string) =>
  (await myInvites(userId)).find((i) => i.wishlistId === wishlistId)!;

describe('GET /api/users/me/invites: what an invite shows of its list', () => {
  it('shows the banner, occasion and published item count of a list anyone can open', async () => {
    const id = await list('everyone');
    await invite(id, 'member');

    expect((await forList(ben, id)).preview).toEqual({
      bannerUrl: 'https://example.com/banner.jpg',
      occasion: OCCASION,
      itemCount: 2,
    });
  });

  it('shows nothing of a private list the invitee is not on', async () => {
    const id = await list('private');
    await invite(id, 'member');

    const card = await forList(ben, id);
    expect(card.preview).toBeNull();
    // Still the name, the inviter and the role.
    expect(card).toMatchObject({ wishlistName: 'List private', invitedByUsername: 'alice' });
  });

  it('shows a private list to a member invited to co-own it, who can already open it', async () => {
    const id = await list('private');
    await WishlistMember.create({ wishlist: id, user: ben });
    await invite(id, 'owner');

    expect((await forList(ben, id)).preview).toMatchObject({ itemCount: 2 });
  });

  it('shows a friends-only list to a friend of an owner, and nothing to anyone else', async () => {
    const id = await list('friends');
    await invite(id, 'member');
    await invite(id, 'member', carol);
    await Follow.create([
      { follower: ben, following: alice },
      { follower: alice, following: ben },
    ]);
    // carol follows alice, but alice doesn't follow back: not friends.
    await Follow.create({ follower: carol, following: alice });

    expect((await forList(ben, id)).preview).toMatchObject({ itemCount: 2 });
    expect((await forList(carol, id)).preview).toBeNull();
  });

  it('shows nothing of an archived list on an owner invite, which is still listed', async () => {
    const id = await list('everyone', true);
    await invite(id, 'owner');

    const card = await forList(ben, id);
    expect(card).toBeDefined();
    expect(card.preview).toBeNull();
  });
});

describe('GET /api/users/me/invites: the reservations an owner invite releases', () => {
  it('counts the invitee’s own reservations on the list, on an owner invite', async () => {
    const id = await list('everyone');
    await reserve(ben, id, 2);
    await invite(id, 'owner');

    expect((await forList(ben, id)).yourReservations).toBe(2);
  });

  it('counts a reservation that outlived its booking, as accepting ends it too', async () => {
    const id = await list('everyone');
    await reserve(ben, id, 1);
    // An owner moved the item to draft: its booking is gone, its Reservation isn't.
    await Item.updateMany({ wishlist: id, bookedBy: ben }, { status: 'draft', bookedBy: null });
    await invite(id, 'owner');

    expect((await forList(ben, id)).yourReservations).toBe(1);
  });

  // regression: the co-owner warning showed to every invitee, whatever they held
  // on the list; the count must be theirs alone, never another gifter's.
  it('regression: never counts another gifter’s reservations', async () => {
    const id = await list('everyone');
    await reserve(carol, id, 3);
    await invite(id, 'owner');

    expect((await forList(ben, id)).yourReservations).toBe(0);
  });

  it('only counts reservations on that list', async () => {
    const id = await list('everyone');
    const other = await list('everyone');
    await reserve(ben, other, 2);
    await invite(id, 'owner');

    expect((await forList(ben, id)).yourReservations).toBe(0);
  });

  it('never carries a count on a member invite', async () => {
    const id = await list('everyone');
    await reserve(ben, id, 2);
    await invite(id, 'member');

    expect(await forList(ben, id)).not.toHaveProperty('yourReservations');
  });

  it('gives each invitee only their own count', async () => {
    const id = await list('everyone');
    await reserve(ben, id, 1);
    await reserve(carol, id, 2);
    await invite(id, 'owner');
    await invite(id, 'owner', carol);

    expect((await forList(ben, id)).yourReservations).toBe(1);
    expect((await forList(carol, id)).yourReservations).toBe(2);
  });
});

describe('the invite notification records the role', () => {
  async function feed(userId: string) {
    session.mockResolvedValueOnce({ user: { id: userId } } as never);
    const res = await getNotifications(new NextRequest('http://localhost/api/notifications'));
    return (await res.json()).data as Array<Record<string, unknown>>;
  }

  it('says which role each invite offers', async () => {
    const owned = await list('everyone');
    const joined = await list('private');
    const issue = (wishlistId: string, role: 'owner' | 'member') =>
      issueWishlistInvite({
        wishlistId,
        wishlistName: 'List',
        role,
        invitedBy: alice,
        inviterName: 'alice',
        actorUsername: 'alice',
        invitedUserId: ben,
      });
    await issue(owned, 'owner');
    await issue(joined, 'member');

    const rows = await feed(ben);
    expect(rows.find((r) => r.wishlistId === owned)).toMatchObject({
      type: 'wishlist_invite',
      inviteRole: 'owner',
    });
    expect(rows.find((r) => r.wishlistId === joined)).toMatchObject({ inviteRole: 'member' });
  });
});
