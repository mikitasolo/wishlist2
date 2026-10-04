import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as migrate } from '@/app/api/migrations/relabel-answered-invite-notifications/route';
import { GET as getFeed } from '@/app/api/notifications/route';
import { notificationText, type NotificationView } from '@/lib/utils/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** A fixed point well in the past, so every answer here is long settled. */
const T0 = Date.now() - 30 * DAY;
const at = (offsetMs: number) => new Date(T0 + offsetMs);

let ben: mongoose.Types.ObjectId; // owns the lists and invites
let anna: mongoose.Types.ObjectId; // the invitee
let cara: mongoose.Types.ObjectId; // another invitee
let listId: mongoose.Types.ObjectId;
let otherList: mongoose.Types.ObjectId;

async function makeUser(username: string) {
  return (await User.create({ email: `${username}@x.com`, username }))._id;
}

/** An invite with the timestamps it'd have had, written raw so they stick. */
async function inviteRow(opts: {
  user: mongoose.Types.ObjectId;
  list?: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
  updatedAt?: Date;
}) {
  const _id = new mongoose.Types.ObjectId();
  await WishlistInvite.collection.insertOne({
    _id,
    wishlist: opts.list ?? listId,
    invitedBy: ben,
    invitedUser: opts.user,
    role: 'member',
    status: opts.status,
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt ?? opts.createdAt,
  });
  return _id;
}

/** A pre-WIS-230 invite notification: no `inviteAnswer`, as it was written. */
async function notificationRow(opts: {
  user: mongoose.Types.ObjectId;
  list?: mongoose.Types.ObjectId;
  createdAt: Date;
  read?: boolean;
}) {
  const _id = new mongoose.Types.ObjectId();
  await Notification.collection.insertOne({
    _id,
    user: opts.user,
    type: 'wishlist_invite',
    actorUsername: 'ben',
    wishlist: opts.list ?? listId,
    wishlistName: 'Ben’s housewarming',
    read: opts.read ?? false,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  return _id;
}

function run(secret = 'test-migration-secret') {
  return migrate(
    new NextRequest('http://localhost/api/migrations/relabel-answered-invite-notifications', {
      method: 'POST',
      headers: { 'X-Migration-Secret': secret },
    })
  );
}

async function rowOf(id: mongoose.Types.ObjectId) {
  return Notification.findById(id).select('inviteAnswer read').lean();
}

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  ben = await makeUser('ben');
  anna = await makeUser('anna');
  cara = await makeUser('cara');
  listId = (await Wishlist.create({ name: 'Ben’s housewarming', owners: [ben] }))._id;
  otherList = (await Wishlist.create({ name: 'Other list', owners: [ben] }))._id;
});

describe('relabel-answered-invite-notifications migration', () => {
  it('refuses a request without the migration secret, and writes nothing', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    const n = await notificationRow({ user: anna, createdAt: at(10) });
    const res = await run('wrong');
    expect(res.status).toBe(401);
    expect((await rowOf(n))?.inviteAnswer).toBeUndefined();
  });

  // regression: invites answered before WIS-230 kept a notification that still
  // read "@ben invited you to …", as if the invite were still waiting.
  it('writes an accepted or declined answer onto the invitee’s own row, and marks it read', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    const annas = await notificationRow({ user: anna, createdAt: at(10) });
    await inviteRow({ user: cara, status: 'declined', createdAt: at(0), updatedAt: at(DAY) });
    const caras = await notificationRow({ user: cara, createdAt: at(10) });

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      scanned: 2,
      relabelled: 2,
      pending: 0,
      recent: 0,
      unmatched: 0,
    });
    expect(await rowOf(annas)).toMatchObject({ inviteAnswer: 'accepted', read: true });
    expect(await rowOf(caras)).toMatchObject({ inviteAnswer: 'declined', read: true });
  });

  it('makes the feed read the row as the answer', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    await notificationRow({ user: anna, createdAt: at(10) });
    await run();

    session.mockResolvedValue({ user: { id: anna.toString(), username: 'anna' } } as never);
    const res = await getFeed(new NextRequest('http://localhost/api/notifications'));
    const json = await res.json();
    const rows = json.data as NotificationView[];
    expect(rows.map(notificationText)).toEqual(['You joined Ben’s housewarming']);
    expect(json.unreadCount).toBe(0);
  });

  it('leaves a row alone while its invite is still pending', async () => {
    await inviteRow({ user: anna, status: 'pending', createdAt: at(0) });
    const n = await notificationRow({ user: anna, createdAt: at(10) });
    const res = await run();
    expect(await res.json()).toMatchObject({ relabelled: 0, pending: 1 });
    expect(await rowOf(n)).toMatchObject({ read: false });
    expect((await rowOf(n))?.inviteAnswer).toBeUndefined();
  });

  it('leaves a row alone when no invite of that person to that list matches', async () => {
    // Another person's answered invite, and the same person's on another list.
    await inviteRow({ user: cara, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    await inviteRow({
      user: anna,
      list: otherList,
      status: 'accepted',
      createdAt: at(0),
      updatedAt: at(DAY),
    });
    // An invite created after the row isn't the one it was written for.
    await inviteRow({ user: anna, status: 'declined', createdAt: at(20), updatedAt: at(DAY) });
    const n = await notificationRow({ user: anna, createdAt: at(10) });

    const res = await run();
    expect(await res.json()).toMatchObject({ relabelled: 0, unmatched: 1 });
    expect((await rowOf(n))?.inviteAnswer).toBeUndefined();
  });

  it('labels each row by its own invite after a re-invite', async () => {
    // Declined, then invited again and accepted.
    await inviteRow({ user: anna, status: 'declined', createdAt: at(0), updatedAt: at(DAY) });
    const first = await notificationRow({ user: anna, createdAt: at(10) });
    await inviteRow({
      user: anna,
      status: 'accepted',
      createdAt: at(2 * DAY),
      updatedAt: at(3 * DAY),
    });
    const second = await notificationRow({ user: anna, createdAt: at(2 * DAY + 10) });

    await run();
    expect(await rowOf(first)).toMatchObject({ inviteAnswer: 'declined' });
    expect(await rowOf(second)).toMatchObject({ inviteAnswer: 'accepted' });
  });

  // A later invite that was cancelled is deleted, and its notification with it,
  // best-effort. A row that survived it must not take the earlier invite's answer.
  it('never gives a row the answer of an older invite it wasn’t written for', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    // Written after that invite's answer: a cancelled re-invite's leftover.
    const afterAnswer = await notificationRow({ user: anna, createdAt: at(2 * DAY) });
    const res = await run();
    expect(await res.json()).toMatchObject({ relabelled: 0, unmatched: 1 });
    expect((await rowOf(afterAnswer))?.inviteAnswer).toBeUndefined();
  });

  it('never gives a row an answer when it was written long after its invite', async () => {
    // An invite whose last change came much later (so the answer bound can't tell).
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(5 * DAY) });
    const late = await notificationRow({ user: anna, createdAt: at(DAY) });
    const res = await run();
    expect(await res.json()).toMatchObject({ relabelled: 0, unmatched: 1 });
    expect((await rowOf(late))?.inviteAnswer).toBeUndefined();
  });

  // An accept whose grant fails reopens its claim moments after writing
  // `accepted`, and a live answer records itself; neither is this migration's.
  it('skips an invite answered just now', async () => {
    const now = Date.now();
    await inviteRow({
      user: anna,
      status: 'accepted',
      createdAt: new Date(now - 60 * 1000),
      updatedAt: new Date(now - 1000),
    });
    const n = await notificationRow({ user: anna, createdAt: new Date(now - 59 * 1000) });
    const res = await run();
    expect(await res.json()).toMatchObject({ relabelled: 0, recent: 1 });
    expect((await rowOf(n))?.inviteAnswer).toBeUndefined();
  });

  it('is idempotent, and never overwrites an answer already recorded', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    const n = await notificationRow({ user: anna, createdAt: at(10) });
    // Already answered live (WIS-230): not scanned at all.
    await inviteRow({ user: cara, status: 'declined', createdAt: at(0), updatedAt: at(DAY) });
    const live = await notificationRow({ user: cara, createdAt: at(10) });
    await Notification.collection.updateOne(
      { _id: live },
      { $set: { inviteAnswer: 'accepted', read: true } }
    );

    expect(await (await run()).json()).toMatchObject({ scanned: 1, relabelled: 1 });
    expect(await (await run()).json()).toMatchObject({ scanned: 0, relabelled: 0 });
    expect(await rowOf(n)).toMatchObject({ inviteAnswer: 'accepted', read: true });
    expect(await rowOf(live)).toMatchObject({ inviteAnswer: 'accepted' });
  });

  it('touches no other kind of notification', async () => {
    await inviteRow({ user: anna, status: 'accepted', createdAt: at(0), updatedAt: at(DAY) });
    const _id = new mongoose.Types.ObjectId();
    await Notification.collection.insertOne({
      _id,
      user: anna,
      type: 'invite_accepted',
      wishlist: listId,
      read: false,
      createdAt: at(10),
      updatedAt: at(10),
    });
    expect(await (await run()).json()).toMatchObject({ scanned: 0 });
    expect(await rowOf(_id)).toMatchObject({ read: false });
  });
});
