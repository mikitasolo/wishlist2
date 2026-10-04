import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import {
  PATCH as demoteOwner,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { DELETE as kickMember } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import { createNotification } from '@/lib/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

let usernames: Record<string, string> = {};

/** Signed in as `userId`, username and all, so a leaked actor would show. */
function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId, username: usernames[userId] } } as never);
}

function req(url: string, method: string) {
  return new NextRequest('http://localhost' + url, { method });
}

const demote = (caller: string, target: string) => {
  as(caller);
  return demoteOwner(req(`/api/wishlists/${wid}/owners/${target}`, 'PATCH'), {
    params: Promise.resolve({ id: wid, userId: target }),
  });
};
const remove = (caller: string, target: string) => {
  as(caller);
  return removeOwner(req(`/api/wishlists/${wid}/owners/${target}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, userId: target }),
  });
};
const kick = async (caller: string, member: string) => {
  const row = await WishlistMember.findOne({ wishlist: wid, user: member });
  const memberId = row!._id.toString();
  as(caller);
  return kickMember(req(`/api/wishlists/${wid}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, memberId }),
  });
};
const leaveAs = (userId: string) => {
  as(userId);
  return leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: wid }),
  });
};

/** Every notification in the database, so "nobody else" is checked too. */
const allNotifications = () => Notification.find().lean();

let alice: string; // owner
let bob: string; // co-owner
let carol: string; // member
let wid: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();

  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  [alice, bob, carol] = [await user('alice'), await user('bob'), await user('carol')];
  usernames = { [alice]: 'alice', [bob]: 'bob', [carol]: 'carol' };

  wid = (
    await Wishlist.create({
      name: 'Family list',
      slug: 'family-list',
      owners: [alice, bob],
      visibility: 'everyone',
    })
  )._id.toString();
  await WishlistMember.create({ wishlist: wid, user: carol });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('losing a role on a list notifies the person who lost it', () => {
  it('a demotion sends exactly one role_changed, to the demoted owner only', async () => {
    const res = await demote(alice, bob);
    expect(res.status).toBe(200);

    const sent = await allNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'role_changed',
      actorUsername: null,
      wishlistName: 'Family list',
      wishlistSlug: 'family-list',
      read: false,
    });
    expect(sent[0].user.toString()).toBe(bob);
    expect(sent[0].wishlist?.toString()).toBe(wid);
  });

  it('removing an owner sends exactly one removed_from_wishlist, with nothing to link to', async () => {
    const res = await remove(alice, bob);
    expect(res.status).toBe(200);

    const sent = await allNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'removed_from_wishlist',
      actorUsername: null,
      wishlistName: 'Family list',
      wishlistSlug: null,
    });
    expect(sent[0].user.toString()).toBe(bob);
  });

  it('kicking a member sends exactly one removed_from_wishlist, to them only', async () => {
    const res = await kick(alice, carol);
    expect(res.status).toBe(200);

    const sent = await allNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'removed_from_wishlist',
      actorUsername: null,
      wishlistName: 'Family list',
      wishlistSlug: null,
    });
    expect(sent[0].user.toString()).toBe(carol);
  });

  it('leaving is your own doing, so it notifies nobody', async () => {
    expect((await leaveAs(carol)).status).toBe(200);
    expect((await leaveAs(bob)).status).toBe(200);

    expect(await allNotifications()).toHaveLength(0);
  });
});

describe('a change that did not land notifies nobody', () => {
  it('a demotion that loses to the owner leaving sends nothing', async () => {
    // Bob has left completely before alice's demotion writes his membership.
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', () => leaveAs(bob));

    const res = await demote(alice, bob);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    // Bob is no longer an owner (WIS-61: this used to be the last-owner 400).
    expect(res.status).toBe(404);
    expect(await allNotifications()).toHaveLength(0);
  });

  it('of two owners removing each other at once, only the one removed hears of it', async () => {
    // Bob removes alice while alice's removal of bob is held before its write.
    const race = holdFirstCall(Wishlist, 'updateOne', () => remove(bob, alice));

    const res = await remove(alice, bob);

    expect(race.outcome()?.status).toBe(200);
    expect(res.status).toBe(403);
    const sent = await allNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('removed_from_wishlist');
    expect(sent[0].user.toString()).toBe(alice);
  });

  it('a kick that loses to the member leaving sends nothing', async () => {
    // Carol leaves after the kick's checks but before its delete.
    const race = holdFirstCall(WishlistMember, 'deleteOne', () => leaveAs(carol));

    const res = await kick(alice, carol);

    expect(race.outcome()?.status).toBe(200);
    expect(res.status).toBe(404);
    expect(await allNotifications()).toHaveLength(0);
  });
});

describe('role-change notifications never name an actor', () => {
  it('drops an actor a caller passes, as it does for proposals', async () => {
    for (const type of ['role_changed', 'removed_from_wishlist'] as const) {
      await createNotification({ user: bob, type, actorUsername: 'alice', wishlist: wid });
    }

    const sent = await allNotifications();
    expect(sent).toHaveLength(2);
    expect(sent.every((n) => n.actorUsername === null)).toBe(true);
  });
});
