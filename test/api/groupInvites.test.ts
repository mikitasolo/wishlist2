import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { POST } from '@/app/api/wishlists/[id]/members/group/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  removeGroupMember,
} from '@/lib/utils/peopleGroups';
import {
  INVITE_REFUSAL,
  PENDING_INVITE_CAP,
  PENDING_INVITE_CAP_ERROR,
} from '@/lib/utils/wishlistInvites';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

// WIS-37: inviting one of your groups to a list fans out to one ordinary
// invite per person, each held to every rule of a single invite.

const session = vi.mocked(auth);

let ann: string; // owns the list and the group
let listId: string;

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);
afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  ann = (await User.create({ email: 'ann@x.com', username: 'ann' }))._id.toString();
  listId = (
    await Wishlist.create({ name: 'Birthday', owners: [ann], visibility: 'everyone' })
  )._id.toString();
});

async function person(
  username: string,
  whoCanInvite: 'everyone' | 'friends' | 'nobody' = 'everyone'
): Promise<string> {
  const user = await User.create({
    email: `${username}@x.com`,
    username,
    privacy: { whoCanInvite },
  });
  return user._id.toString();
}

/** A group of `ownerId`'s with these people in it (followed first, as tagging needs). */
async function groupOf(ownerId: string, name: string, people: string[]): Promise<string> {
  const made = await createGroup(ownerId, name);
  if (made.status !== 'created') throw new Error('group not created');
  for (const p of people) {
    await Follow.create({ follower: ownerId, following: p });
    expect(await addGroupMember(ownerId, made.group.id, p)).toBe('added');
  }
  return made.group.id;
}

function inviteGroup(body: unknown, userId: string | null = ann, id = listId) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/members/group`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

async function answer(inviteId: string, userId: string, action: 'accept' | 'decline') {
  session.mockResolvedValue({ user: { id: userId } } as never);
  return respondInvite(
    new NextRequest('http://localhost/api/invites/' + inviteId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ inviteId }) }
  );
}

/** A limiter that allows `allowed` calls, then refuses; `calls` counts them. */
function countingLimiter(allowed: number, onCall?: (n: number) => Promise<void>) {
  const state = { calls: 0 };
  const limiter: RateLimiter = {
    async limit() {
      state.calls++;
      await onCall?.(state.calls);
      const success = state.calls <= allowed;
      return { success, reset: Date.now() + 60_000, limit: allowed, remaining: 0 };
    },
  };
  return { limiter, state };
}

describe('POST /api/wishlists/[id]/members/group', () => {
  it('invites the eligible people only and reports a reason for each of the others', async () => {
    const bo = await person('bo');
    const cy = await person('cy');
    const di = await person('di');
    const ed = await person('ed', 'nobody');
    const fay = await person('fay', 'friends');
    await WishlistMember.create({ wishlist: listId, user: cy });
    await WishlistInvite.create({ wishlist: listId, invitedBy: ann, invitedUser: di });
    const group = await groupOf(ann, 'Family', [bo, cy, di, ed, fay]);

    const res = await inviteGroup({ groupId: group });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.invited).toEqual([{ id: bo, username: 'bo', displayName: 'bo' }]);
    expect(body.data.skipped.map((s: { username: string; reason: string }) => s)).toEqual([
      { id: cy, username: 'cy', displayName: 'cy', reason: INVITE_REFUSAL.member },
      { id: di, username: 'di', displayName: 'di', reason: INVITE_REFUSAL.pending },
      { id: ed, username: 'ed', displayName: 'ed', reason: INVITE_REFUSAL.nobody },
      { id: fay, username: 'fay', displayName: 'fay', reason: INVITE_REFUSAL.friendsOnly },
    ]);
    expect(body.data.notInvited).toBe(0);
    // Nobody's email is in the answer.
    expect(JSON.stringify(body)).not.toContain('@x.com');

    const pending = await WishlistInvite.find({ wishlist: listId, status: 'pending' }).lean();
    expect(pending.map((i) => i.invitedUser.toString()).sort()).toEqual([bo, di].sort());
    expect(pending.find((i) => i.invitedUser.toString() === bo)?.role).toBe('member');
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  // Operator decision (2026-10-07): invites go by username only, so a group
  // never reaches someone a single invite couldn't.
  it('skips someone with no username, named by their public name, spending no token', async () => {
    const bo = await person('bo');
    // `name` comes only from an identity provider, through the adapter, so
    // it's written as the adapter does, outside the schema.
    const { insertedId } = await User.collection.insertOne({
      email: 'sam.ivanov@x.com',
      name: 'Sam Ivanov',
    });
    const nameless = insertedId.toString();
    const group = await groupOf(ann, 'Family', [nameless, bo]);
    const { limiter, state } = countingLimiter(10);
    __setRateLimiters({ invite: limiter });

    const body = await (await inviteGroup({ groupId: group })).json();
    expect(body.data.invited.map((p: { id: string }) => p.id)).toEqual([bo]);
    expect(body.data.skipped).toEqual([
      {
        id: nameless,
        username: null,
        displayName: 'Sam Ivanov',
        reason: INVITE_REFUSAL.noUsername,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('sam.ivanov');
    expect(state.calls).toBe(1);
    expect(await WishlistInvite.exists({ invitedUser: nameless })).toBeNull();
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('invites a friends-only person who is a friend', async () => {
    const fay = await person('fay', 'friends');
    const group = await groupOf(ann, 'Friends', [fay]);
    await Follow.create({ follower: fay, following: ann });
    const body = await (await inviteGroup({ groupId: group })).json();
    expect(body.data.invited.map((p: { id: string }) => p.id)).toEqual([fay]);
  });

  it('skips co-owners, and a member when the invite is an owner one, with the single wording', async () => {
    const co = await person('co');
    const cy = await person('cy');
    const bo = await person('bo');
    await Wishlist.updateOne({ _id: listId }, { $push: { owners: co } });
    await WishlistMember.create({ wishlist: listId, user: cy });
    const group = await groupOf(ann, 'Family', [co, cy, bo]);

    const body = await (await inviteGroup({ groupId: group, role: 'owner' })).json();
    expect(body.data.invited.map((p: { id: string }) => p.id)).toEqual([bo]);
    expect(body.data.skipped.map((s: { reason: string }) => s.reason)).toEqual([
      INVITE_REFUSAL.owner,
      INVITE_REFUSAL.memberAsOwner,
    ]);
    const invite = await WishlistInvite.findOne({ invitedUser: bo }).lean();
    expect(invite?.role).toBe('owner');
  });

  it('skips someone at the pending-invite cap with the cap wording', async () => {
    const bo = await person('bo');
    const docs = [];
    for (let i = 0; i < PENDING_INVITE_CAP; i++) {
      const inviter = new mongoose.Types.ObjectId();
      const list = await Wishlist.create({
        name: `L${i}`,
        owners: [inviter],
        visibility: 'everyone',
      });
      docs.push({ wishlist: list._id, invitedBy: inviter, invitedUser: bo });
    }
    await WishlistInvite.insertMany(docs);
    const group = await groupOf(ann, 'Family', [bo]);

    const body = await (await inviteGroup({ groupId: group })).json();
    expect(body.data.invited).toEqual([]);
    expect(body.data.skipped[0].reason).toBe(PENDING_INVITE_CAP_ERROR);
    expect(await WishlistInvite.countDocuments({ wishlist: listId })).toBe(0);
  });

  it('spends one invite token per person tried, and counts the rest once it runs dry', async () => {
    const people = [];
    for (const name of ['p1', 'p2', 'p3', 'p4']) people.push(await person(name));
    const member = await person('cy');
    await WishlistMember.create({ wishlist: listId, user: member });
    const group = await groupOf(ann, 'Many', [member, ...people]);
    const { limiter, state } = countingLimiter(2);
    __setRateLimiters({ invite: limiter });

    const body = await (await inviteGroup({ groupId: group })).json();
    expect(body.data.invited.map((p: { id: string }) => p.id)).toEqual(people.slice(0, 2));
    expect(body.data.skipped.map((s: { id: string }) => s.id)).toEqual([member]);
    expect(body.data.notInvited).toBe(2);
    // The member skipped up front spent nothing; the limiter isn't asked again once dry.
    expect(state.calls).toBe(3);
    expect(await WishlistInvite.countDocuments({ wishlist: listId })).toBe(2);
  });

  it('a group of someone else, a missing one and a malformed id are the same 404', async () => {
    const bo = await person('bo');
    const other = await person('other');
    const theirs = await groupOf(other, 'Theirs', [bo]);
    const answers = [];
    for (const groupId of [theirs, new mongoose.Types.ObjectId().toString(), 'nope']) {
      const res = await inviteGroup({ groupId });
      answers.push([res.status, await res.json()]);
    }
    expect(answers).toEqual(Array(3).fill([404, { success: false, error: 'Group not found' }]));
    expect(await WishlistInvite.countDocuments()).toBe(0);
  });

  it('refuses a caller who does not own the list, with their own group', async () => {
    const bo = await person('bo');
    const stranger = await person('stranger');
    const group = await groupOf(stranger, 'Mine', [bo]);
    const res = await inviteGroup({ groupId: group }, stranger);
    expect(res.status).toBe(403);
    expect(await WishlistInvite.countDocuments()).toBe(0);
  });

  it('401s when signed out', async () => {
    expect((await inviteGroup({ groupId: 'x' }, null)).status).toBe(401);
  });

  it('pauses member invites on an archived list, but still sends owner ones', async () => {
    const bo = await person('bo');
    const group = await groupOf(ann, 'Family', [bo]);
    await Wishlist.updateOne({ _id: listId }, { archived: true });

    const res = await inviteGroup({ groupId: group });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Unarchive this list to invite members',
    });
    expect(await WishlistInvite.countDocuments()).toBe(0);

    const owner = await (await inviteGroup({ groupId: group, role: 'owner' })).json();
    expect(owner.data.invited.map((p: { id: string }) => p.id)).toEqual([bo]);
  });

  it('answers an empty group with nothing invited', async () => {
    const made = await createGroup(ann, 'Empty');
    if (made.status !== 'created') throw new Error();
    const body = await (await inviteGroup({ groupId: made.group.id })).json();
    expect(body.data).toEqual({ invited: [], skipped: [], notInvited: 0 });
  });

  it('accepting one invite of a fan-out leaves the others pending', async () => {
    const bo = await person('bo');
    const cy = await person('cy');
    const di = await person('di');
    const group = await groupOf(ann, 'Family', [bo, cy, di]);
    await inviteGroup({ groupId: group });

    const boInvite = await WishlistInvite.findOne({ invitedUser: bo }).lean();
    expect((await answer(boInvite!._id.toString(), bo, 'accept')).status).toBe(200);
    const cyInvite = await WishlistInvite.findOne({ invitedUser: cy }).lean();
    expect((await answer(cyInvite!._id.toString(), cy, 'decline')).status).toBe(200);

    expect(await WishlistMember.exists({ wishlist: listId, user: bo })).toBeTruthy();
    expect(await WishlistMember.exists({ wishlist: listId, user: di })).toBeNull();
    const di_ = await WishlistInvite.findOne({ invitedUser: di }).lean();
    expect(di_?.status).toBe('pending');
  });

  it('deleting the group, or taking someone out of it, leaves the invites and memberships', async () => {
    const bo = await person('bo');
    const cy = await person('cy');
    const group = await groupOf(ann, 'Family', [bo, cy]);
    await inviteGroup({ groupId: group });
    const boInvite = await WishlistInvite.findOne({ invitedUser: bo }).lean();
    await answer(boInvite!._id.toString(), bo, 'accept');

    await removeGroupMember(ann, group, cy);
    await deleteGroup(ann, group);
    expect(await WishlistMember.exists({ wishlist: listId, user: bo })).toBeTruthy();
    expect((await WishlistInvite.findOne({ invitedUser: cy }).lean())?.status).toBe('pending');
  });

  // The single invite's race, per person: a co-owner takes the caller off the
  // list mid-fan-out, after that removal's `cancelInvitesSentBy` already ran.
  it('takes back every invite it issued once the caller is no longer an owner', async () => {
    const co = await person('co');
    await Wishlist.updateOne({ _id: listId }, { $push: { owners: co } });
    const bo = await person('bo');
    const cy = await person('cy');
    const di = await person('di');
    const group = await groupOf(ann, 'Family', [bo, cy, di]);
    // The second person's token is spent just as the caller is removed.
    const { limiter } = countingLimiter(10, async (n) => {
      if (n === 2) await Wishlist.updateOne({ _id: listId }, { $pull: { owners: ann } });
    });
    __setRateLimiters({ invite: limiter });

    const res = await inviteGroup({ groupId: group });
    expect(res.status).toBe(403);
    expect(await WishlistInvite.countDocuments({ wishlist: listId, status: 'pending' })).toBe(0);
    expect(await Notification.countDocuments({ wishlist: listId, type: 'wishlist_invite' })).toBe(
      0
    );
    // Stopped there: the third person was never tried.
    expect(await WishlistInvite.exists({ invitedUser: di })).toBeNull();
  });

  it('answers a list deleted mid-fan-out with its 404', async () => {
    const bo = await person('bo');
    const cy = await person('cy');
    const group = await groupOf(ann, 'Family', [bo, cy]);
    const { limiter } = countingLimiter(10, async (n) => {
      if (n === 2) await Wishlist.deleteOne({ _id: listId });
    });
    __setRateLimiters({ invite: limiter });
    const res = await inviteGroup({ groupId: group });
    expect(res.status).toBe(404);
    expect(await WishlistInvite.countDocuments({ status: 'pending' })).toBe(0);
  });
});
