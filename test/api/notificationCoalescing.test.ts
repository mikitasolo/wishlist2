import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn().mockReturnValue(null),
}));

import { auth } from '@/lib/auth';
import { GET as getFeed, PATCH as markAllRead } from '@/app/api/notifications/route';
import { POST as followRoute, DELETE as unfollowRoute } from '@/app/api/users/[id]/follow/route';
import { POST as postItem } from '@/app/api/wishlists/[id]/items/route';
import { createNotification, COALESCE_WINDOW_MS } from '@/lib/notifications';
import { notificationText, type NotificationView } from '@/lib/utils/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

// Routes read session.user.{id,username}.
const users = new Map<string, string>(); // id -> username
function as(id: string) {
  session.mockResolvedValue({ user: { id, username: users.get(id) } } as never);
}

async function makeUser(username: string): Promise<string> {
  const id = (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  users.set(id, username);
  return id;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (path: string) => `http://localhost${path}`;

async function follow(actor: string, target: string) {
  as(actor);
  const res = await followRoute(
    new NextRequest(url(`/api/users/${target}/follow`), { method: 'POST' }),
    ctx(target)
  );
  expect(res.status).toBe(200);
}

async function unfollow(actor: string, target: string) {
  as(actor);
  const res = await unfollowRoute(
    new NextRequest(url(`/api/users/${target}/follow`), { method: 'DELETE' }),
    ctx(target)
  );
  expect(res.status).toBe(200);
}

async function propose(member: string, wishlistId: string, name: string) {
  as(member);
  const res = await postItem(
    new NextRequest(url(`/api/wishlists/${wishlistId}/items`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, status: 'proposed' }),
    }),
    ctx(wishlistId)
  );
  expect(res.status).toBe(201);
}

async function feedOf(userId: string): Promise<NotificationView[]> {
  as(userId);
  const res = await getFeed(new NextRequest('http://localhost/api/notifications'));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

/** Push a row's createdAt into the past (the timestamps plugin blocks a model-level $set). */
async function age(id: unknown, ms: number) {
  await Notification.collection.updateOne(
    { _id: id as never },
    { $set: { createdAt: new Date(Date.now() - ms) } }
  );
}

const HOUR = 60 * 60 * 1000;
const oid = (id: string) => new mongoose.Types.ObjectId(id);

let rita: string; // the one being followed / the list owner

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  users.clear();
  rita = await makeUser('rita');
});

describe('follow notifications coalesce', () => {
  it('folds 5 follows in a row into 1 row reading "… and 4 others"', async () => {
    const followers = [];
    for (const name of ['ann', 'ben', 'cat', 'dan', 'eve']) followers.push(await makeUser(name));
    for (const f of followers) await follow(f, rita);

    const rows = await Notification.find({ user: rita });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
    // Only the latest 3 are kept; the newest is also the single-actor field.
    expect(rows[0].actorUsernames).toEqual(['cat', 'dan', 'eve']);
    expect(rows[0].actorUsername).toBe('eve');
    expect(rows[0].read).toBe(false);

    const feed = await feedOf(rita);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ count: 5, actorUsernames: ['cat', 'dan', 'eve'] });
    expect(notificationText(feed[0])).toBe('@eve and 4 others followed you');
  });

  // regression: unfollow deletes the Follow edge, so the next follow's upsert
  // counted as new and notified again — every round of churn was a fresh row.
  it('notifies once for follow → unfollow → follow', async () => {
    const ann = await makeUser('ann');
    await follow(ann, rita);
    await unfollow(ann, rita);
    await follow(ann, rita);

    const rows = await Notification.find({ user: rita });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].actorUsernames).toEqual(['ann']);
  });

  it('drops churn even after the first notification was read', async () => {
    const ann = await makeUser('ann');
    await follow(ann, rita);
    as(rita);
    await markAllRead();

    await unfollow(ann, rita);
    await follow(ann, rita);

    const rows = await Notification.find({ user: rita });
    expect(rows).toHaveLength(1);
    expect(rows[0].read).toBe(true);
  });

  it('recognises churn from a row written before coalescing (actorUsername only)', async () => {
    const ann = await makeUser('ann');
    await Notification.collection.insertOne({
      user: oid(rita),
      type: 'follow',
      actorUsername: 'ann',
      read: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await follow(ann, rita);
    expect(await Notification.countDocuments({ user: rita })).toBe(1);
  });

  it('does not fold into a row the recipient already read', async () => {
    const ann = await makeUser('ann');
    const ben = await makeUser('ben');
    await follow(ann, rita);
    as(rita);
    await markAllRead();
    await follow(ben, rita);

    const unread = await Notification.find({ user: rita, read: false });
    expect(unread).toHaveLength(1);
    expect(unread[0].count).toBe(1);
    expect(unread[0].actorUsername).toBe('ben');
    expect(await Notification.countDocuments({ user: rita })).toBe(2);
  });

  it('starts a new row, and lets the same actor notify again, after 24h', async () => {
    const ann = await makeUser('ann');
    const ben = await makeUser('ben');
    await follow(ann, rita);
    const first = await Notification.findOne({ user: rita });
    await age(first!._id, COALESCE_WINDOW_MS + HOUR);

    await follow(ben, rita);
    expect(await Notification.countDocuments({ user: rita })).toBe(2);

    // ann's only row is now outside the window, so her re-follow counts again.
    await unfollow(ann, rita);
    await follow(ann, rita);
    const fresh = await Notification.findOne({ user: rita, read: false }).sort({ createdAt: -1 });
    expect(fresh!.count).toBe(2);
    expect(fresh!.actorUsernames).toEqual(['ben', 'ann']);
  });

  it('moves the coalesced row back to the top of the feed', async () => {
    const ann = await makeUser('ann');
    const ben = await makeUser('ben');
    await follow(ann, rita);
    const followRow = await Notification.findOne({ user: rita });
    await age(followRow!._id, HOUR);
    await createNotification({ user: rita, type: 'wishlist_invite', actorUsername: 'zed' });
    const invite = await Notification.findOne({ user: rita, type: 'wishlist_invite' });
    await age(invite!._id, HOUR / 2);

    await follow(ben, rita);

    const feed = await feedOf(rita);
    expect(feed.map((n) => n.type)).toEqual(['follow', 'wishlist_invite']);
    expect(notificationText(feed[0])).toBe('@ben and @ann followed you');
    expect(Date.now() - new Date(feed[0].createdAt).getTime()).toBeLessThan(60_000);
  });

  // Only the coalescing upsert opts in to moving createdAt; the schema declares
  // it non-immutable for that, and every other update must still leave it be.
  it('leaves createdAt alone for an ordinary update', async () => {
    const ann = await makeUser('ann');
    await follow(ann, rita);
    const before = (await Notification.findOne({ user: rita }))!.createdAt.getTime();
    const past = new Date('2020-01-01');

    await Notification.updateOne({ user: rita }, { $set: { createdAt: past } });
    await Notification.updateMany({ user: rita }, { $set: { createdAt: past, read: true } });
    await Notification.findOneAndUpdate(
      { user: rita },
      { $set: { createdAt: past } },
      { upsert: true }
    );

    const doc = (await Notification.findOne({ user: rita }))!;
    doc.createdAt = past;
    await doc.save();

    const after = await Notification.find({ user: rita });
    expect(after).toHaveLength(1);
    expect(after[0].createdAt.getTime()).toBe(before);
  });

  // The window slides: each event bumps createdAt, and the next one folds in
  // if that bump is under 24h old, however long ago the burst began.
  it('keeps folding into a row last bumped under 24h ago', async () => {
    const ann = await makeUser('ann');
    const ben = await makeUser('ben');
    const cat = await makeUser('cat');
    await follow(ann, rita);
    const row = await Notification.findOne({ user: rita });
    await age(row!._id, COALESCE_WINDOW_MS - HOUR);
    await follow(ben, rita);
    await age(row!._id, COALESCE_WINDOW_MS - HOUR);
    await follow(cat, rita);

    const rows = await Notification.find({ user: rita });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it('keeps per-recipient rows apart', async () => {
    const ann = await makeUser('ann');
    const sam = await makeUser('sam');
    await follow(ann, rita);
    await follow(ann, sam);

    expect(await Notification.countDocuments({ user: rita })).toBe(1);
    expect(await Notification.countDocuments({ user: sam })).toBe(1);
  });
});

describe('proposal notifications coalesce per (owner, wishlist)', () => {
  let otto: string; // co-owner
  let mia: string; // member
  let max: string; // member
  let kitchen: string;
  let garden: string;

  beforeEach(async () => {
    otto = await makeUser('otto');
    mia = await makeUser('mia');
    max = await makeUser('max');
    kitchen = (
      await Wishlist.create({
        name: 'Kitchen',
        slug: 'kitchen',
        owners: [rita, otto],
        visibility: 'everyone',
      })
    )._id.toString();
    garden = (
      await Wishlist.create({
        name: 'Garden',
        slug: 'garden',
        owners: [rita, otto],
        visibility: 'everyone',
      })
    )._id.toString();
    for (const w of [kitchen, garden]) {
      for (const m of [mia, max]) await WishlistMember.create({ wishlist: w, user: m });
    }
  });

  // regression: proposals are anonymous to the owner. Coalescing must not bring
  // the proposer back — no actorUsername, no actor list — and every co-owner
  // still gets the notification (createNotifications fans out to all owners).
  it('a coalesced proposal row carries no actor, for every owner', async () => {
    await propose(mia, kitchen, 'Kettle');
    await propose(max, kitchen, 'Toaster');
    await propose(mia, kitchen, 'Whisk');

    for (const owner of [rita, otto]) {
      const rows = await Notification.collection
        .find({ user: oid(owner), type: 'proposal' })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(3);
      expect(rows[0].actorUsername).toBeNull();
      // Absent, not just empty: nothing about the proposers is stored.
      expect(rows[0]).not.toHaveProperty('actorUsernames');

      const feed = await feedOf(owner);
      expect(feed).toHaveLength(1);
      expect(feed[0].actorUsername).toBeNull();
      expect(feed[0].actorUsernames).toEqual([]);
      const text = notificationText(feed[0]);
      expect(text).toBe('3 new proposals on Kitchen');
      for (const name of ['mia', 'max']) expect(JSON.stringify(feed[0])).not.toContain(name);
    }
    // Members get nothing.
    expect(await Notification.countDocuments({ user: { $in: [mia, max] } })).toBe(0);
  });

  it('stays anonymous even if a caller passes an actor', async () => {
    await createNotification({
      user: rita,
      type: 'proposal',
      actorUsername: 'mia',
      wishlist: kitchen,
      wishlistName: 'Kitchen',
    });
    await createNotification({
      user: rita,
      type: 'proposal',
      actorUsername: 'max',
      wishlist: kitchen,
      wishlistName: 'Kitchen',
    });

    const rows = await Notification.collection.find({ type: 'proposal' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].actorUsername).toBeNull();
    expect(rows[0]).not.toHaveProperty('actorUsernames');
  });

  it('does not merge proposals on two different wishlists', async () => {
    await propose(mia, kitchen, 'Kettle');
    await propose(mia, garden, 'Rake');
    await propose(max, garden, 'Hose');

    const rows = await Notification.find({ user: rita, type: 'proposal' }).sort({
      wishlistName: 1,
    });
    expect(rows.map((r) => [r.wishlistName, r.count])).toEqual([
      ['Garden', 2],
      ['Kitchen', 1],
    ]);
  });

  it('starts a new row once the owner has read the last one', async () => {
    await propose(mia, kitchen, 'Kettle');
    as(rita);
    await markAllRead();
    await propose(max, kitchen, 'Toaster');

    const rows = await Notification.find({ user: rita, type: 'proposal' });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => !r.read)!.count).toBe(1);
    // otto never read his, so both proposals sit in one row for him.
    const ottos = await Notification.find({ user: otto, type: 'proposal' });
    expect(ottos).toHaveLength(1);
    expect(ottos[0].count).toBe(2);
  });
});

describe('actionable and one-off notifications are not coalesced', () => {
  it.each(['wishlist_invite', 'invite_accepted', 'proposal_approved'] as const)(
    '%s writes one row per event',
    async (type) => {
      const list = (await Wishlist.create({ name: 'Trip', owners: [rita], visibility: 'everyone' }))
        ._id;
      for (const actor of ['ann', 'ann', 'ben']) {
        await createNotification({
          user: rita,
          type,
          actorUsername: actor,
          wishlist: list,
          wishlistName: 'Trip',
        });
      }

      const rows = await Notification.find({ user: rita, type });
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.count).toBe(1);
        expect(r.actorUsernames).toBeUndefined();
      }
    }
  );
});
