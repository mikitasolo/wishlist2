import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as SEARCH } from '@/app/api/search/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

const session = vi.mocked(auth);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
});

type Privacy = { searchable?: boolean; profileVisibility?: 'everyone' | 'friends' };

async function user(username: string, privacy: Privacy = {}) {
  const u = await User.create({
    email: `${username}@x.com`,
    username,
    image: `https://img.example/${username}.png`,
    privacy,
  });
  return u._id.toString();
}

const follow = (follower: string, following: string) => Follow.create({ follower, following });
async function befriend(a: string, b: string) {
  await follow(a, b);
  await follow(b, a);
}

async function list(
  name: string,
  owners: string[],
  visibility: 'everyone' | 'friends' | 'private' = 'everyone',
  extra: Record<string, unknown> = {}
) {
  const wl = await Wishlist.create({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    owners,
    visibility,
    isPublic: visibility === 'everyone',
    ...extra,
  });
  return wl._id.toString();
}

const join = (wishlist: string, member: string) =>
  WishlistMember.create({ wishlist, user: member });

async function search(q: string, as: string | null) {
  session.mockResolvedValue(as ? ({ user: { id: as } } as never) : (null as never));
  const res = await SEARCH(
    new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`)
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data as {
    users: { username: string; image: string | null }[];
    wishlists: { _id: string; name: string; slug: string | null; ownerUsername: string | null }[];
  };
}

const listNames = async (q: string, as: string | null) =>
  (await search(q, as)).wishlists.map((w) => w.name);
const usernames = async (q: string, as: string | null) =>
  (await search(q, as)).users.map((u) => u.username);

describe('GET /api/search — which lists it returns', () => {
  // A co-owned list, so the friends tier is checked against *any* owner.
  let owner: string;
  let coOwner: string;
  let member: string;
  let friendOfCoOwner: string;
  let follower: string; // follows the co-owner, who doesn't follow back
  let stranger: string;

  beforeEach(async () => {
    owner = await user('owner');
    coOwner = await user('coowner');
    member = await user('member');
    friendOfCoOwner = await user('friendofcoowner');
    follower = await user('follower');
    stranger = await user('stranger');
    await befriend(coOwner, friendOfCoOwner);
    await follow(follower, coOwner);
  });

  it('shows a public list to anyone, signed out included', async () => {
    await list('Public gifts', [owner, coOwner]);
    for (const viewer of [null, stranger, member, owner]) {
      expect(await listNames('gifts', viewer)).toEqual(['Public gifts']);
    }
  });

  it('shows a friends-only list to a friend of a co-owner, but not to a non-friend or signed out', async () => {
    await list('Friends gifts', [owner, coOwner], 'friends');

    expect(await listNames('gifts', friendOfCoOwner)).toEqual(['Friends gifts']);
    expect(await listNames('gifts', follower)).toEqual([]);
    expect(await listNames('gifts', stranger)).toEqual([]);
    expect(await listNames('gifts', null)).toEqual([]);
  });

  it('shows a private list to its owners and members only', async () => {
    const id = await list('Private gifts', [owner, coOwner], 'private');
    await join(id, member);

    expect(await listNames('gifts', member)).toEqual(['Private gifts']);
    expect(await listNames('gifts', owner)).toEqual(['Private gifts']);
    expect(await listNames('gifts', coOwner)).toEqual(['Private gifts']);
    expect(await listNames('gifts', friendOfCoOwner)).toEqual([]);
    expect(await listNames('gifts', stranger)).toEqual([]);
    expect(await listNames('gifts', null)).toEqual([]);
  });

  it('shows an archived list to its owners only, whatever its tier', async () => {
    const id = await list('Archived gifts', [owner, coOwner], 'everyone', { archived: true });
    await join(id, member);

    expect(await listNames('gifts', owner)).toEqual(['Archived gifts']);
    expect(await listNames('gifts', coOwner)).toEqual(['Archived gifts']);
    for (const viewer of [member, friendOfCoOwner, stranger, null]) {
      expect(await listNames('gifts', viewer)).toEqual([]);
    }
  });
});

describe('GET /api/search — privacy settings', () => {
  it('never shows someone who turned off searchable, not even to a friend or on an exact match', async () => {
    const hidden = await user('hiddenhank', { searchable: false });
    const friend = await user('friend');
    await befriend(hidden, friend);

    expect(await usernames('hiddenhank', friend)).toEqual([]);
    expect(await usernames('hiddenhank', null)).toEqual([]);
  });

  it('keeps the lists of someone who shows their wishlists to friends only out of a non-friend’s results', async () => {
    const shy = await user('shy', { profileVisibility: 'friends' });
    const friend = await user('friend');
    const member = await user('member');
    const stranger = await user('stranger');
    await befriend(shy, friend);
    const id = await list('Shy gifts', [shy]);
    await join(id, member);

    expect(await listNames('gifts', null)).toEqual([]);
    expect(await listNames('gifts', stranger)).toEqual([]);
    expect(await listNames('gifts', friend)).toEqual(['Shy gifts']);
    expect(await listNames('gifts', member)).toEqual(['Shy gifts']);
    expect(await listNames('gifts', shy)).toEqual(['Shy gifts']);
    // Their username and avatar stay public: profile visibility doesn't hide people.
    expect(await usernames('shy', stranger)).toEqual(['shy']);
  });

  it('applies that to every co-owner of a list', async () => {
    const shy = await user('shy', { profileVisibility: 'friends' });
    const open = await user('open');
    const stranger = await user('stranger');
    await list('Shared gifts', [open, shy]);

    expect(await listNames('gifts', stranger)).toEqual([]);
    expect(await listNames('gifts', open)).toEqual(['Shared gifts']);
  });

  it('returns only username + image for people and name + slug + owner username for lists', async () => {
    const owner = await user('gifter');
    await list('Gifter list', [owner]);

    const data = await search('gifter', null);
    expect(data.users).toEqual([{ username: 'gifter', image: 'https://img.example/gifter.png' }]);
    expect(data.wishlists).toHaveLength(1);
    expect(Object.keys(data.wishlists[0]).sort()).toEqual(['_id', 'name', 'ownerUsername', 'slug']);
    expect(data.wishlists[0]).toMatchObject({
      name: 'Gifter list',
      slug: 'gifter-list',
      ownerUsername: 'gifter',
    });
  });
});

describe('GET /api/search — the query', () => {
  it('matches a query that looks like an aggregation expression as plain text', async () => {
    await user('$$root');
    await user('ali');
    // Each would be a bad field path or an undefined variable if it reached the
    // pipeline as an expression; `search` asserts every one answers 200.
    for (const q of ['$$x', '$a.', '$..', '$username']) {
      expect(await usernames(q, null)).toEqual([]);
    }
    expect(await usernames('$', null)).toEqual(['$$root']);
    expect(await usernames('$$ROOT', null)).toEqual(['$$root']);
  });
});

describe('GET /api/search — ranking', () => {
  it('ranks people: exact match, friends, following, followers, everyone else; prefix before substring', async () => {
    const me = await user('searcher');
    await user('ali'); // a stranger, but the exact match
    const friend = await user('alizfriend');
    const subFriend = await user('xalifriend');
    const followed = await user('alizfollowing');
    const followsMe = await user('alizfollower');
    await user('aliastranger'); // alphabetically first, but a stranger
    await user('xalistranger'); // a stranger and only a substring match: past the limit
    await befriend(me, friend);
    await befriend(me, subFriend);
    await follow(me, followed);
    await follow(followsMe, me);

    expect(await usernames('ali', me)).toEqual([
      'ali',
      'alizfriend',
      'xalifriend',
      'alizfollowing',
      'alizfollower',
      'aliastranger',
    ]);
    // Signed out there's no graph: exact match, then prefix, then substring.
    expect(await usernames('ali', null)).toEqual([
      'ali',
      'aliastranger',
      'alizfollower',
      'alizfollowing',
      'alizfriend',
      'xalifriend',
    ]);
  });

  it('puts a friend before a stranger with the same prefix', async () => {
    const me = await user('searcher');
    await user('samanta');
    const friend = await user('samzz');
    await befriend(me, friend);

    expect(await usernames('sam', me)).toEqual(['samzz', 'samanta']);
  });

  it('ranks lists: yours and ones you belong to, friends’, everyone else’s; prefix before substring, then most recently updated', async () => {
    const me = await user('searcher');
    const friend = await user('friend');
    const stranger = await user('stranger');
    await befriend(me, friend);

    await list('Old birthday', [me]); // mine, substring
    const memberOf = await list('Birthday at home', [stranger], 'private'); // member, prefix
    await join(memberOf, me);
    await list('A birthday', [friend], 'friends'); // friend's, substring
    await list('Birthday fund', [stranger, friend]); // a co-owner is a friend, prefix
    const older = await list('Birthday 2026', [stranger]);
    const newer = await list('Birthday 2027', [stranger]);
    await list('My birthday', [stranger]); // stranger's, substring: past the limit
    await Wishlist.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(older) },
      { $set: { updatedAt: new Date('2026-01-01') } }
    );
    await Wishlist.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(newer) },
      { $set: { updatedAt: new Date('2026-06-01') } }
    );

    expect(await listNames('birth', me)).toEqual([
      'Birthday at home',
      'Old birthday',
      'Birthday fund',
      'A birthday',
      'Birthday 2027',
      'Birthday 2026',
    ]);
  });
});
