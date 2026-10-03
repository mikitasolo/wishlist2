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
    const res = await GET();
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
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.unreadCount).toBe(1);
    // Newest first.
    expect(json.data[0].actorUsername).toBe('cara');
  });
});

describe('GET /api/notifications — who did it', () => {
  const feedOf = async (userId: string) => {
    asSession({ id: userId });
    return (await (await GET()).json()).data as Record<string, unknown>[];
  };
  const byType = (rows: Record<string, unknown>[], type: string) =>
    rows.find((r) => r.type === type)!;

  it('gives a follow its follower as they are now, and whether you follow them back', async () => {
    await User.updateOne({ _id: bob }, { $set: { image: 'https://blob.example/bob.jpg' } });
    const cara = (await User.create({ email: 'cara@x.com', username: 'cara' }))._id.toString();
    await Notification.create({ user: alice, type: 'follow', actorUsername: 'bob' });
    await Notification.create({ user: alice, type: 'follow', actorUsername: 'cara' });
    await Follow.create({ follower: alice, following: cara });

    const rows = await feedOf(alice);
    const fromBob = rows.find((r) => r.actorUsername === 'bob')!;
    expect(fromBob).toMatchObject({
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

  it('says nothing of following on a follow by several people, or on any other type', async () => {
    await Notification.create({
      user: alice,
      type: 'follow',
      actorUsername: 'bob',
      actorUsernames: ['cara', 'bob'],
      count: 2,
    });
    await Notification.create({
      user: alice,
      type: 'invite_accepted',
      actorUsername: 'bob',
      wishlistName: 'Kitchen',
    });

    const rows = await feedOf(alice);
    // The avatar is still the latest follower's.
    expect(byType(rows, 'follow')).toMatchObject({ actorId: bob, followingActor: null });
    expect(byType(rows, 'invite_accepted')).toMatchObject({ actorId: bob, followingActor: null });
  });

  it('leaves the actor out when no account has that username any more', async () => {
    await Notification.create({ user: alice, type: 'follow', actorUsername: 'renamed' });
    expect((await feedOf(alice))[0]).toMatchObject({
      actorId: null,
      actorImage: null,
      followingActor: null,
    });
  });

  // Proposals are anonymous to the owners, and a demotion or a removal never
  // says which owner made it: whatever a row holds, none comes back with a face.
  it('never looks up anyone on a proposal, a demotion or a removal', async () => {
    await User.updateOne({ _id: bob }, { $set: { image: 'https://blob.example/bob.jpg' } });
    for (const type of ['proposal', 'role_changed', 'removed_from_wishlist'] as const) {
      // Written straight to the collection, past createNotification's stripping,
      // as a row from before it would be.
      await Notification.collection.insertOne({
        user: new mongoose.Types.ObjectId(alice),
        type,
        actorUsername: 'bob',
        wishlistName: 'Kitchen',
        read: false,
        createdAt: new Date(),
      });
    }

    const rows = await feedOf(alice);
    expect(rows).toHaveLength(3);
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
