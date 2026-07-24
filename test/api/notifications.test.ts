import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/notifications/route';
import { POST as followUser } from '@/app/api/users/[id]/follow/route';
import User from '@/models/User';
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
    // Go through the raw driver — the timestamps plugin makes createdAt
    // immutable, so a model-level $set is ignored.
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
