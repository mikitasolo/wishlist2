import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as BY_USERNAME } from '@/app/api/users/by-username/[username]/route';
import { GET as USER_WISHLISTS } from '@/app/api/users/[id]/wishlists/route';
import { GET as GET_USER } from '@/app/api/users/[id]/route';
import { POST as FOLLOW, DELETE as UNFOLLOW } from '@/app/api/users/[id]/follow/route';
import { GET as FOLLOWERS } from '@/app/api/users/[id]/followers/route';
import { GET as FOLLOWING } from '@/app/api/users/[id]/following/route';
import { PATCH as PATCH_ME } from '@/app/api/users/me/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

const session = vi.mocked(auth);

let targetId: string;
let friendId: string;
let strangerId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const target = await User.create({
    email: 'target@x.com',
    username: 'target',
    bio: 'Hi, I collect mugs.',
    privacy: { profileVisibility: 'friends' },
  });
  const friend = await User.create({ email: 'friend@x.com', username: 'friend' });
  const stranger = await User.create({ email: 'stranger@x.com', username: 'stranger' });
  targetId = target._id.toString();
  friendId = friend._id.toString();
  strangerId = stranger._id.toString();
  // Mutual follow → friends.
  await Follow.create([
    { follower: target._id, following: friend._id },
    { follower: friend._id, following: target._id },
  ]);
  // A public wishlist owned by the target.
  await Wishlist.create({ name: 'Mugs', owners: [target._id], visibility: 'everyone' });
});

function profile(userId?: string) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
  const req = new NextRequest('http://localhost/api/users/by-username/target');
  return BY_USERNAME(req, { params: Promise.resolve({ username: 'target' }) });
}

function wishlists(userId?: string) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
  const req = new NextRequest('http://localhost/api/users/' + targetId + '/wishlists');
  return USER_WISHLISTS(req, { params: Promise.resolve({ id: targetId }) });
}

describe('by-username — bio visibility under friends-only', () => {
  // Regression: profileVisibility 'friends' must hide the bio from non-friends,
  // while keeping username/avatar public.
  it('regression: hides the bio from a stranger but keeps the username', async () => {
    const res = await profile(strangerId);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.username).toBe('target'); // still discoverable
    expect(json.data.bio).toBeNull(); // bio withheld
  });

  it('hides the bio from anonymous viewers', async () => {
    const json = await (await profile()).json();
    expect(json.data.bio).toBeNull();
  });

  it('shows the bio to a friend', async () => {
    const json = await (await profile(friendId)).json();
    expect(json.data.bio).toBe('Hi, I collect mugs.');
  });

  it('shows the bio to the owner', async () => {
    const json = await (await profile(targetId)).json();
    expect(json.data.bio).toBe('Hi, I collect mugs.');
  });

  it('shows the bio to everyone when profileVisibility is everyone', async () => {
    await User.updateOne({ _id: targetId }, { $set: { 'privacy.profileVisibility': 'everyone' } });
    const json = await (await profile(strangerId)).json();
    expect(json.data.bio).toBe('Hi, I collect mugs.');
  });
});

describe('users/[id]/wishlists — list visibility under friends-only', () => {
  // Regression: friends-only gates browsing the aggregate wishlist list.
  it('regression: a stranger is blocked from browsing the list (403 restricted)', async () => {
    const res = await wishlists(strangerId);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.restricted).toBe(true);
  });

  it('a friend can browse the list', async () => {
    const res = await wishlists(friendId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.some((w: { name: string }) => w.name === 'Mugs')).toBe(true);
  });

  it('the owner can browse their own list', async () => {
    expect((await wishlists(targetId)).status).toBe(200);
  });

  it('everyone can browse when profileVisibility is everyone', async () => {
    await User.updateOne({ _id: targetId }, { $set: { 'privacy.profileVisibility': 'everyone' } });
    const res = await wishlists(strangerId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.some((w: { name: string }) => w.name === 'Mugs')).toBe(true);
  });
});

describe('users/[id]/wishlists — what visitors see, told to the owner alone', () => {
  beforeEach(async () => {
    await User.updateOne({ _id: targetId }, { $set: { 'privacy.profileVisibility': 'everyone' } });
    const [target, friend, stranger] = [targetId, friendId, strangerId].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    // 'Mugs' (everyone) is already there.
    await Wishlist.create({ name: 'Friends', owners: [target], visibility: 'friends' });
    const hidden = await Wishlist.create({
      name: 'Hidden',
      owners: [target],
      visibility: 'private',
    });
    await Wishlist.create({ name: 'Shared', owners: [target, friend], visibility: 'everyone' });
    await Wishlist.create({
      name: 'Old',
      owners: [target],
      visibility: 'everyone',
      archived: true,
    });
    // The stranger is a member of the private list, so they see it too.
    await WishlistMember.create({ wishlist: hidden._id, user: stranger });
  });

  it('counts, for the owner, the lists a signed-out visitor could open', async () => {
    const res = await wishlists(targetId);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Every active list, and archived ones in neither number.
    expect(json.data.map((w: { name: string }) => w.name).sort()).toEqual([
      'Friends',
      'Hidden',
      'Mugs',
      'Shared',
    ]);
    expect(json.visitorCount).toBe(2);
  });

  it('tells the owner, and only the owner, how many of their lists are archived', async () => {
    const own = await (await wishlists(targetId)).json();
    expect(own.archivedCount).toBe(1);
    for (const viewer of [undefined, friendId, strangerId]) {
      expect(await (await wishlists(viewer)).json()).not.toHaveProperty('archivedCount');
    }
  });

  it('sends no count to anyone else: signed out, a friend, a co-owner or a member', async () => {
    for (const viewer of [undefined, friendId, strangerId]) {
      const json = await (await wishlists(viewer)).json();
      expect(json.success).toBe(true);
      expect(json).not.toHaveProperty('visitorCount');
      expect(JSON.stringify(json)).not.toMatch(/visitor/i);
    }
  });

  it('keeps archived lists off everyone else’s view of the profile', async () => {
    for (const viewer of [undefined, friendId, strangerId]) {
      const json = await (await wishlists(viewer)).json();
      expect(json.data.some((w: { name: string }) => w.name === 'Old')).toBe(false);
    }
  });
});

describe('users/[id] routes — a malformed id', () => {
  const BAD_IDS = ['not-an-id', '12345', 'z'.repeat(24)];
  const at = (path: string, method = 'GET') =>
    new NextRequest('http://localhost/api/users/' + path, { method });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  // regression: a malformed id made the user lookup throw a CastError, so these
  // routes answered 500 instead of their "User not found" 404.
  it.each(BAD_IDS)(
    'regression: GET /users/[id], its wishlists and follow answer 404 (%s)',
    async (badId) => {
      session.mockResolvedValue({ user: { id: strangerId } } as never);

      const responses = [
        await GET_USER(at(badId), params(badId)),
        await USER_WISHLISTS(at(`${badId}/wishlists`), params(badId)),
        await FOLLOW(at(`${badId}/follow`, 'POST'), params(badId)),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: 'User not found' });
      }
      expect(await Follow.countDocuments()).toBe(2);
    }
  );

  // regression: these query the follow edges with the raw id, so a malformed one
  // threw a CastError and they answered 500. They have no "not found": an id that
  // matches nobody has nothing to unfollow and no followers, and a malformed id
  // now gets exactly that answer.
  it.each(BAD_IDS)(
    'regression: unfollow, followers and following answer as for an unknown user (%s)',
    async (badId) => {
      const ghost = new mongoose.Types.ObjectId().toString();
      session.mockResolvedValue({ user: { id: friendId } } as never);

      const routes = [
        (id: string) => UNFOLLOW(at(`${id}/follow`, 'DELETE'), params(id)),
        (id: string) => FOLLOWERS(at(`${id}/followers`), params(id)),
        (id: string) => FOLLOWING(at(`${id}/following`), params(id)),
      ];
      for (const route of routes) {
        const [malformed, unknown] = [await route(badId), await route(ghost)];
        expect(malformed.status).toBe(200);
        expect(await malformed.json()).toEqual(await unknown.json());
      }
      expect(await Follow.countDocuments()).toBe(2);
    }
  );

  it('answers a signed-out follow or unfollow with the 401, before looking at the id', async () => {
    session.mockResolvedValue(null as never);

    expect((await FOLLOW(at('not-an-id/follow', 'POST'), params('not-an-id'))).status).toBe(401);
    expect((await UNFOLLOW(at('not-an-id/follow', 'DELETE'), params('not-an-id'))).status).toBe(
      401
    );
  });
});

describe('PATCH /api/users/me — saving the settings', () => {
  function save(body: unknown) {
    session.mockResolvedValue({ user: { id: targetId } } as never);
    return PATCH_ME(
      new NextRequest('http://localhost/api/users/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  it("writes what it's sent, and keeps the privacy settings it isn't", async () => {
    const res = await save({
      username: 'MugFan',
      bio: '  Still collecting mugs.  ',
      defaultCurrency: 'eur',
      privacy: { searchable: false },
    });

    expect(res.status).toBe(200);
    const saved = {
      username: 'mugfan',
      bio: 'Still collecting mugs.',
      defaultCurrency: 'EUR',
      privacy: { searchable: false, whoCanInvite: 'everyone', profileVisibility: 'friends' },
    };
    expect((await res.json()).data).toMatchObject({ ...saved, email: 'target@x.com' });
    expect(await User.findById(targetId).lean()).toMatchObject(saved);
  });

  it('clears the bio, and leaves what it was not sent alone', async () => {
    expect((await save({ bio: '' })).status).toBe(200);
    expect(await User.findById(targetId).lean()).toMatchObject({
      username: 'target',
      bio: null,
      privacy: { profileVisibility: 'friends' },
    });
  });

  it('refuses a username someone else has, and writes nothing', async () => {
    const res = await save({ username: 'friend', bio: 'Changed' });

    expect(res.status).toBe(409);
    expect(await User.findById(targetId).lean()).toMatchObject({
      username: 'target',
      bio: 'Hi, I collect mugs.',
    });
  });
});
