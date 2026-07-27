import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as BY_USERNAME } from '@/app/api/users/by-username/[username]/route';
import { GET as USER_WISHLISTS } from '@/app/api/users/[id]/wishlists/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';

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
