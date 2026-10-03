import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/notifications/route';
import { POST as followUser } from '@/app/api/users/[id]/follow/route';
import mongoose from 'mongoose';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Notification from '@/models/Notification';
import { createNotification } from '@/lib/notifications';

const session = vi.mocked(auth);
// The route only reads session.user.{id,username}; cast to satisfy the mock.
const asSession = (user: { id: string; username?: string }) =>
  session.mockResolvedValue({ user } as never);

let alice: string;
let bob: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const a = await User.create({ email: 'alice@x.com', username: 'alice' });
  const b = await User.create({ email: 'bob@x.com', username: 'bob' });
  alice = a._id.toString();
  bob = b._id.toString();
});

describe('GET /api/notifications', () => {
  it('401s without a session', async () => {
    session.mockResolvedValue(null as never);
    const res = await GET(new NextRequest('http://localhost/api/notifications'));
    expect(res.status).toBe(401);
  });

  it('returns only the current user’s notifications, newest first, with an unread count', async () => {
    const older = await Notification.create({
      user: alice,
      type: 'follow',
      actorUsername: 'bob',
      read: false,
    });
    const newer = await Notification.create({
      user: alice,
      type: 'follow',
      actorUsername: 'cara',
      read: true,
    });
    // Force deterministic ordering (auto timestamps can collide within a ms).
    // Go through the raw driver — the timestamps plugin strips createdAt from
    // a model-level $set.
    await Notification.collection.updateOne(
      { _id: older._id },
      { $set: { createdAt: new Date('2026-01-01') } }
    );
    await Notification.collection.updateOne(
      { _id: newer._id },
      { $set: { createdAt: new Date('2026-06-01') } }
    );
    // Belongs to bob — must not leak to alice.
    await Notification.create({ user: bob, type: 'follow', actorUsername: 'alice' });

    asSession({ id: alice, username: 'alice' });
    const res = await GET(new NextRequest('http://localhost/api/notifications'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.unreadCount).toBe(1);
    // Newest first.
    expect(json.data[0].actorUsername).toBe('cara');
  });
});

describe('GET /api/notifications — who did it', () => {
  const feedOf = async (userId: string, query = '?actors=1') => {
    asSession({ id: userId, username: 'alice' });
    const res = await GET(new NextRequest(`http://localhost/api/notifications${query}`));
    return (await res.json()).data as Record<string, unknown>[];
  };
  const followAs = async (follower: { id: string; username: string }, target: string) => {
    asSession(follower);
    await followUser(new NextRequest('http://localhost/api/users/x/follow', { method: 'POST' }), {
      params: Promise.resolve({ id: target }),
    });
  };
  const newUser = async (username: string) =>
    (await User.create({ email: `${username}-new@x.com`, username }))._id.toString();

  it('gives a follow its follower as they are now, and whether you follow them back', async () => {
    await User.updateOne({ _id: bob }, { $set: { image: 'https://blob.example/bob.jpg' } });
    const cara = await newUser('cara');
    await followAs({ id: bob, username: 'bob' }, alice);
    // A day apart, so the two aren't folded into one row.
    await Notification.updateMany({}, { $set: { read: true } });
    await followAs({ id: cara, username: 'cara' }, alice);
    await Follow.create({ follower: alice, following: cara });

    const rows = await feedOf(alice);
    expect(rows.find((r) => r.actorUsername === 'bob')).toMatchObject({
      actorId: bob,
      actorImage: 'https://blob.example/bob.jpg',
      followingActor: false,
    });
    expect(rows.find((r) => r.actorUsername === 'cara')).toMatchObject({
      actorId: cara,
      actorImage: null,
      followingActor: true,
    });
  });

  it('shows the latest follower of a coalesced row, with no Follow back', async () => {
    const cara = await newUser('cara');
    await followAs({ id: cara, username: 'cara' }, alice);
    await followAs({ id: bob, username: 'bob' }, alice);

    const [row] = await feedOf(alice);
    expect(row).toMatchObject({ count: 2, actorUsername: 'bob', actorId: bob });
    expect(row.followingActor).toBeNull();
  });

  it('gives an accepted invite its invitee, with nothing about following', async () => {
    await createNotification({
      user: alice,
      type: 'invite_accepted',
      actorUsername: 'bob',
      actor: bob,
      wishlistName: 'Kitchen',
    });
    expect((await feedOf(alice))[0]).toMatchObject({ actorId: bob, followingActor: null });
  });

  // regression: the actor was looked up by the username the row was written
  // with. Usernames change hands, so a row could show a stranger's face, and its
  // Follow back followed the stranger.
  it('regression: keeps to the account that did it once its username changes hands', async () => {
    await followAs({ id: bob, username: 'bob' }, alice);
    await User.updateOne({ _id: bob }, { $set: { username: 'bobby' } });
    const stranger = await newUser('bob');
    await User.updateOne({ _id: stranger }, { $set: { image: 'https://blob.example/x.jpg' } });

    const [row] = await feedOf(alice);
    expect(row).toMatchObject({ actorUsername: 'bob', actorId: bob, actorImage: null });
    expect(row.actorId).not.toBe(stranger);
  });

  it('shows no one on a row from before rows recorded the account', async () => {
    await Notification.create({ user: alice, type: 'follow', actorUsername: 'bob' });
    expect((await feedOf(alice))[0]).toMatchObject({
      actorId: null,
      actorImage: null,
      followingActor: null,
    });
  });

  it('leaves the actor out when that account is gone', async () => {
    await followAs({ id: bob, username: 'bob' }, alice);
    await User.deleteOne({ _id: bob });
    expect((await feedOf(alice))[0]).toMatchObject({ actorId: null, followingActor: null });
  });

  // Activity's unread badge reads this on every page and focus for its count alone.
  it('looks no one up unless asked to', async () => {
    await followAs({ id: bob, username: 'bob' }, alice);
    const find = vi.spyOn(User, 'find');
    const [row] = await feedOf(alice, '');
    expect(row).toMatchObject({ actorId: null, actorImage: null, followingActor: null });
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();
  });

  // Proposals are anonymous to the owners, and a demotion or a removal never
  // says which owner made it: whatever a row holds, none comes back with a face.
  it('never looks up anyone on a proposal, a demotion or a removal', async () => {
    await User.updateOne({ _id: bob }, { $set: { image: 'https://blob.example/bob.jpg' } });
    for (const type of ['proposal', 'role_changed', 'removed_from_wishlist'] as const) {
      // createNotification never records an actor on these: written straight to
      // the collection, past it, to show the read doesn't trust the row.
      await Notification.collection.insertOne({
        user: new mongoose.Types.ObjectId(alice),
        type,
        actorUsername: 'bob',
        actor: new mongoose.Types.ObjectId(bob),
        wishlistName: 'Kitchen',
        read: false,
        createdAt: new Date(),
      });
    }
    // And createNotification drops one handed to it.
    await createNotification({ user: alice, type: 'role_changed', actor: bob, wishlistName: 'K' });
    expect(await Notification.countDocuments({ type: 'role_changed' })).toBe(2);
    expect(
      await Notification.countDocuments({ type: 'role_changed', actor: { $exists: true } })
    ).toBe(1);

    const rows = await feedOf(alice);
    for (const row of rows) {
      expect(row).toMatchObject({ actorId: null, actorImage: null, followingActor: null });
    }
  });
});

describe('PATCH /api/notifications', () => {
  it('marks all of the user’s notifications read', async () => {
    await Notification.create({ user: alice, type: 'follow', read: false });
    await Notification.create({ user: alice, type: 'follow', read: false });

    asSession({ id: alice, username: 'alice' });
    const res = await PATCH();
    expect(res.status).toBe(200);
    expect((await res.json()).unreadCount).toBe(0);
    expect(await Notification.countDocuments({ user: alice, read: false })).toBe(0);
  });
});

describe('follow creates a notification', () => {
  const follow = (targetId: string) =>
    followUser(new NextRequest('http://localhost/api/users/x/follow', { method: 'POST' }), {
      params: Promise.resolve({ id: targetId }),
    });

  // regression: following notifies the target with the follower's username.
  it('notifies the followed user on a new follow', async () => {
    asSession({ id: alice, username: 'alice' });
    await follow(bob);

    const notes = await Notification.find({ user: bob });
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('follow');
    expect(notes[0].actorUsername).toBe('alice');
  });

  // regression: a repeated (idempotent) follow must not stack notifications.
  it('does not create a second notification on a repeat follow', async () => {
    asSession({ id: alice, username: 'alice' });
    await follow(bob);
    await follow(bob);
    expect(await Notification.countDocuments({ user: bob })).toBe(1);
  });
});
