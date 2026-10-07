import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-27: groups are private tags on people you follow. Nobody but the owner
// can read, list, change or infer one; only people the owner follows are in
// one; unfollowing or a deleted account takes them out; and a group never
// touches a list membership or an invite.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ blobs: [], cursor: undefined }),
  put: vi.fn(),
  head: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as LIST, POST as CREATE } from '@/app/api/users/me/groups/route';
import { PATCH as RENAME, DELETE as DELETE_GROUP } from '@/app/api/users/me/groups/[groupId]/route';
import { POST as ADD } from '@/app/api/users/me/groups/[groupId]/members/route';
import { DELETE as REMOVE } from '@/app/api/users/me/groups/[groupId]/members/[userId]/route';
import { POST as FOLLOW, DELETE as UNFOLLOW } from '@/app/api/users/[id]/follow/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as BY_USERNAME } from '@/app/api/users/by-username/[username]/route';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import {
  addGroupMember,
  createGroup,
  GROUP_LIMIT,
  GROUP_MEMBER_LIMIT,
  groupMemberIds,
} from '@/lib/utils/peopleGroups';
import User from '@/models/User';
import Follow from '@/models/Follow';
import PeopleGroup from '@/models/PeopleGroup';
import Notification from '@/models/Notification';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';

const session = vi.mocked(auth);

let ann: string; // owns the groups
let bo: string; // someone Ann follows
let cy: string; // someone else Ann follows
let eve: string; // a stranger Ann doesn't follow, who'd like to know Ann's groups

beforeAll(async () => {
  await connectTestDB();
  await PeopleGroup.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const [a, b, c, e] = await User.create([
    { email: 'ann@x.com', username: 'ann' },
    { email: 'bo@x.com', username: 'bo' },
    // Named by `publicDisplayName` (her username), never by her email or `name`.
    { email: 'cy.secret@x.com', username: 'cy' },
    { email: 'eve@x.com', username: 'eve' },
  ]);
  [ann, bo, cy, eve] = [a, b, c, e].map((u) => u._id.toString());
  // The adapter writes an identity provider's `name` outside the schema.
  await User.collection.updateOne({ _id: c._id }, { $set: { name: 'Cy' } });
  await Follow.create([
    { follower: ann, following: bo },
    { follower: ann, following: cy },
    { follower: eve, following: bo },
  ]);
});

function as(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

function json(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

async function create(userId: string, name: string) {
  as(userId);
  const res = await CREATE(json('POST', '/api/users/me/groups', { name }));
  return { res, body: await res.json() };
}

async function list(userId: string | null) {
  as(userId);
  const res = await LIST();
  return { res, body: await res.json() };
}

async function add(userId: string, groupId: string, member: string) {
  as(userId);
  const res = await ADD(
    json('POST', `/api/users/me/groups/${groupId}/members`, { userId: member }),
    {
      params: Promise.resolve({ groupId }),
    }
  );
  return { res, body: await res.json() };
}

async function remove(userId: string, groupId: string, member: string) {
  as(userId);
  const res = await REMOVE(json('DELETE', `/api/users/me/groups/${groupId}/members/${member}`), {
    params: Promise.resolve({ groupId, userId: member }),
  });
  return { res, body: await res.json() };
}

async function rename(userId: string, groupId: string, name: string) {
  as(userId);
  const res = await RENAME(json('PATCH', `/api/users/me/groups/${groupId}`, { name }), {
    params: Promise.resolve({ groupId }),
  });
  return { res, body: await res.json() };
}

async function destroy(userId: string, groupId: string) {
  as(userId);
  const res = await DELETE_GROUP(json('DELETE', `/api/users/me/groups/${groupId}`), {
    params: Promise.resolve({ groupId }),
  });
  return { res, body: await res.json() };
}

async function membersOf(groupId: string): Promise<string[]> {
  const g = await PeopleGroup.findById(groupId).lean();
  return (g?.members ?? []).map((m) => m.toString()).sort();
}

describe('managing your groups', () => {
  it('creates groups and tags one person into several of them', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    const close = (await create(ann, 'Close friends')).body.data.id;
    expect((await add(ann, family, bo)).res.status).toBe(200);
    expect((await add(ann, close, bo)).res.status).toBe(200);
    expect((await add(ann, close, cy)).res.status).toBe(200);
    // Repeating an add is harmless.
    expect((await add(ann, close, cy)).res.status).toBe(200);

    const { res, body } = await list(ann);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.data).toEqual([
      {
        id: family,
        name: 'Family',
        members: [{ id: bo, username: 'bo', displayName: 'bo', image: null }],
      },
      {
        id: close,
        name: 'Close friends',
        members: [
          { id: bo, username: 'bo', displayName: 'bo', image: null },
          { id: cy, username: 'cy', displayName: 'cy', image: null },
        ],
      },
    ]);
    // Nobody's email, ever.
    expect(JSON.stringify(body)).not.toContain('@x.com');
  });

  it('renames a group, refusing a name it already has in any case', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await create(ann, 'Friends');
    expect((await create(ann, ' family ')).res.status).toBe(409);
    expect((await rename(ann, family, 'FRIENDS')).res.status).toBe(409);
    expect((await rename(ann, family, 'The Ivanovs')).res.status).toBe(200);
    expect((await PeopleGroup.findById(family).lean())?.name).toBe('The Ivanovs');
    // A different person can use the same name for their own group.
    expect((await create(eve, 'Family')).res.status).toBe(201);
  });

  it('refuses a blank name', async () => {
    expect((await create(ann, '   ')).res.status).toBe(400);
  });

  it('takes someone out of a group, and deletes a group', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    await add(ann, family, cy);
    expect((await remove(ann, family, bo)).res.status).toBe(200);
    expect(await membersOf(family)).toEqual([cy]);
    expect((await destroy(ann, family)).res.status).toBe(200);
    expect(await PeopleGroup.countDocuments()).toBe(0);
  });

  it('refuses a signed-out caller everywhere', async () => {
    const family = (await createGroup(ann, 'Family')).status === 'created';
    expect(family).toBe(true);
    expect((await list(null)).res.status).toBe(401);
    as(null);
    expect((await CREATE(json('POST', '/api/users/me/groups', { name: 'x' }))).status).toBe(401);
  });
});

describe('who can be tagged', () => {
  it('only people you follow, never yourself', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    const notFollowed = await add(ann, family, eve);
    expect(notFollowed.res.status).toBe(400);
    expect(notFollowed.body.error).toBe('You can only add people you follow.');
    expect((await add(ann, family, ann)).res.status).toBe(400);
    expect((await add(ann, family, 'not-an-id')).res.status).toBe(400);
    expect((await add(ann, family, new mongoose.Types.ObjectId().toString())).res.status).toBe(400);
    expect(await membersOf(family)).toEqual([]);
  });

  it('tells the tagged person nothing: no notification, nothing on their profile', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    expect(await Notification.countDocuments()).toBe(0);
    as(bo);
    const res = await BY_USERNAME(new NextRequest('http://localhost/api/users/by-username/bo'), {
      params: Promise.resolve({ username: 'bo' }),
    });
    expect(JSON.stringify(await res.json())).not.toMatch(/group|Family/i);
  });

  it('regression: an unfollow landing between the follow check and the write leaves them out', async () => {
    // The add checked the follow, then the unfollow deleted it and took them out
    // of every group, then the add's write landed: the check after the write
    // takes the tag back.
    const family = (await create(ann, 'Family')).body.data.id;
    await Follow.deleteOne({ follower: ann, following: bo });
    vi.spyOn(Follow, 'exists').mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    expect(await addGroupMember(ann, family, bo)).toBe('not-following');
    expect(await membersOf(family)).toEqual([]);
  });
});

describe('limits', () => {
  it(`allows ${GROUP_LIMIT} groups`, async () => {
    for (let i = 0; i < GROUP_LIMIT; i++) {
      expect((await create(ann, `Group ${i}`)).res.status).toBe(201);
    }
    const over = await create(ann, 'One more');
    expect(over.res.status).toBe(409);
    expect(over.body.error).toBe(`You can have up to ${GROUP_LIMIT} groups.`);
  });

  it('regression: two creates racing at the limit never leave more than the limit', async () => {
    for (let i = 0; i < GROUP_LIMIT - 1; i++) await createGroup(ann, `Group ${i}`);
    const results = await Promise.all([createGroup(ann, 'A'), createGroup(ann, 'B')]);
    expect(await PeopleGroup.countDocuments({ owner: ann })).toBeLessThanOrEqual(GROUP_LIMIT);
    expect(results.some((r) => r.status === 'limit')).toBe(true);
  });

  it(`allows ${GROUP_MEMBER_LIMIT} people in a group, racing adds included`, async () => {
    const people = await User.insertMany(
      Array.from({ length: GROUP_MEMBER_LIMIT + 1 }, (_, i) => ({
        email: `p${i}@x.com`,
        username: `p${i}`,
      }))
    );
    await Follow.insertMany(people.map((p) => ({ follower: ann, following: p._id })));
    const family = (await create(ann, 'Family')).body.data.id;
    await PeopleGroup.updateOne(
      { _id: family },
      { $set: { members: people.slice(0, GROUP_MEMBER_LIMIT - 1).map((p) => p._id) } }
    );
    const [a, b] = await Promise.all([
      addGroupMember(ann, family, people[GROUP_MEMBER_LIMIT - 1]._id.toString()),
      addGroupMember(ann, family, people[GROUP_MEMBER_LIMIT]._id.toString()),
    ]);
    expect([a, b].sort()).toEqual(['added', 'full']);
    expect((await membersOf(family)).length).toBe(GROUP_MEMBER_LIMIT);
    // Someone already in it is still "added" when the group is full.
    expect(await addGroupMember(ann, family, people[0]._id.toString())).toBe('added');
    const over = await add(ann, family, bo);
    expect(over.res.status).toBe(409);
    expect(over.body.error).toBe(`A group can have up to ${GROUP_MEMBER_LIMIT} people.`);
  });
});

describe('privacy: nobody but the owner can read, list, change or infer a group', () => {
  it('lists only the caller’s own groups', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    expect((await list(eve)).body.data).toEqual([]);
    // Not even the person in it.
    expect((await list(bo)).body.data).toEqual([]);
  });

  it('answers someone else’s group exactly as one that does not exist, and changes nothing', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    const missing = new mongoose.Types.ObjectId().toString();

    for (const groupId of [family, missing, 'not-an-id']) {
      const renamed = await rename(eve, groupId, 'Mine now');
      expect([renamed.res.status, renamed.body]).toEqual([
        404,
        { success: false, error: 'Group not found' },
      ]);
      const deleted = await destroy(eve, groupId);
      expect([deleted.res.status, deleted.body]).toEqual([
        404,
        { success: false, error: 'Group not found' },
      ]);
      // Eve follows Bo, so a follow check can't tell her anything either.
      const added = await add(eve, groupId, bo);
      expect([added.res.status, added.body]).toEqual([
        404,
        { success: false, error: 'Group not found' },
      ]);
      const removed = await remove(eve, groupId, bo);
      expect([removed.res.status, removed.body]).toEqual([
        404,
        { success: false, error: 'Group not found' },
      ]);
    }

    const group = await PeopleGroup.findById(family).lean();
    expect(group?.name).toBe('Family');
    expect(group?.members.map(String)).toEqual([bo]);
  });

  it('groupMemberIds gives the ids only to the owner, the same null otherwise', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    await add(ann, family, cy);
    expect((await groupMemberIds(ann, family))?.sort()).toEqual([bo, cy].sort());
    expect(await groupMemberIds(eve, family)).toBeNull();
    expect(await groupMemberIds(ann, new mongoose.Types.ObjectId().toString())).toBeNull();
    expect(await groupMemberIds(ann, 'not-an-id')).toBeNull();
  });

  it('groupMemberIds leaves out anyone no longer followed or no longer there', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    const gone = new mongoose.Types.ObjectId();
    // Rows a racing write could have left behind.
    await PeopleGroup.updateOne({ _id: family }, { $set: { members: [bo, cy, eve, gone] } });
    await Follow.create({ follower: ann, following: gone });
    expect((await groupMemberIds(ann, family))?.sort()).toEqual([bo, cy].sort());
  });
});

describe('unfollowing and deleted accounts', () => {
  it('unfollowing someone takes them out of all your groups, and nobody else’s', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    const close = (await create(ann, 'Close friends')).body.data.id;
    const evesGroup = (await create(eve, 'Book club')).body.data.id;
    await add(ann, family, bo);
    await add(ann, close, bo);
    await add(ann, close, cy);
    await add(eve, evesGroup, bo);

    as(ann);
    const res = await UNFOLLOW(json('DELETE', `/api/users/${bo}/follow`), {
      params: Promise.resolve({ id: bo }),
    });
    expect(res.status).toBe(200);
    expect(await membersOf(family)).toEqual([]);
    expect(await membersOf(close)).toEqual([cy]);
    expect(await membersOf(evesGroup)).toEqual([bo]);
  });

  it('deleting an account deletes its groups and takes it out of everyone else’s', async () => {
    await Follow.create({ follower: eve, following: ann });
    const family = (await create(ann, 'Family')).body.data.id;
    const evesGroup = (await create(eve, 'Book club')).body.data.id;
    await add(ann, family, bo);
    await add(eve, evesGroup, ann);
    await add(eve, evesGroup, bo);

    expect(await deleteAccount(ann, { agreedListIds: [] })).toBe('deleted');
    expect(await PeopleGroup.exists({ owner: ann })).toBeNull();
    expect(await membersOf(evesGroup)).toEqual([bo]);
  });
});

describe('a group never touches a list membership or an invite', () => {
  it('deleting a group or taking someone out leaves memberships and invites as they were', async () => {
    const list = await Wishlist.create({ name: 'Birthday', owners: [ann], visibility: 'private' });
    await WishlistMember.create({ wishlist: list._id, user: bo });
    await WishlistInvite.create({ wishlist: list._id, invitedBy: ann, invitedUser: cy });
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    await add(ann, family, cy);

    await remove(ann, family, bo);
    await destroy(ann, family);

    expect(await WishlistMember.countDocuments({ wishlist: list._id, user: bo })).toBe(1);
    expect(
      await WishlistInvite.countDocuments({
        wishlist: list._id,
        invitedUser: cy,
        status: 'pending',
      })
    ).toBe(1);
  });
});

describe('stale tags and rate limiting', () => {
  it('regression: an unfollow whose group cleanup fails still unfollows, and the tag is never shown or used', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    await add(ann, family, bo);
    vi.spyOn(PeopleGroup, 'updateMany').mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    as(ann);
    const res = await UNFOLLOW(json('DELETE', `/api/users/${bo}/follow`), {
      params: Promise.resolve({ id: bo }),
    });
    expect(res.status).toBe(200);
    expect(await Follow.exists({ follower: ann, following: bo })).toBeNull();
    // The row is still there, but nothing reads it as a member.
    expect(await membersOf(family)).toEqual([bo]);
    expect((await list(ann)).body.data[0].members).toEqual([]);
    expect(await groupMemberIds(ann, family)).toEqual([]);

    // Following them again starts them in none of your groups.
    as(ann);
    await FOLLOW(json('POST', `/api/users/${bo}/follow`), { params: Promise.resolve({ id: bo }) });
    expect(await membersOf(family)).toEqual([]);
  });

  it('limits changes to your groups, changing nothing once over', async () => {
    const family = (await create(ann, 'Family')).body.data.id;
    const denyAll: RateLimiter = {
      async limit() {
        return { success: false, reset: Date.now() + 60_000, limit: 300, remaining: 0 };
      },
    };
    __setRateLimiters({ groups: denyAll });
    try {
      expect((await create(ann, 'Friends')).res.status).toBe(429);
      expect((await add(ann, family, bo)).res.status).toBe(429);
      expect((await rename(ann, family, 'Kin')).res.status).toBe(429);
      expect((await destroy(ann, family)).res.status).toBe(429);
      expect((await remove(ann, family, bo)).res.status).toBe(429);
      expect((await list(ann)).res.status).toBe(200);
    } finally {
      __setRateLimiters(null);
    }
    const group = await PeopleGroup.findById(family).lean();
    expect([group?.name, group?.members.length]).toEqual(['Family', 0]);
    expect(await PeopleGroup.countDocuments()).toBe(1);
  });
});
