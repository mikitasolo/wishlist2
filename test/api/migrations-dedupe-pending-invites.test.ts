import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/migrations/dedupe-pending-invites/route';
import WishlistInvite from '@/models/WishlistInvite';

function run() {
  return POST(
    new NextRequest('http://localhost/api/migrations/dedupe-pending-invites', {
      method: 'POST',
      headers: { 'X-Migration-Secret': process.env.MIGRATION_SECRET! },
    })
  );
}

const oid = () => new mongoose.Types.ObjectId();
const wishlistA = oid();
const wishlistB = oid();
const carol = oid();
const dave = oid();
const inviter = oid();

/**
 * An environment that predates the unique index: raw inserts, straight to a
 * collection without it (the index would refuse the duplicates we need to seed).
 */
async function seed(rows: Record<string, unknown>[]) {
  const { insertedIds } = await WishlistInvite.collection.insertMany(
    rows.map((row) => ({
      _id: oid(),
      invitedBy: inviter,
      role: 'member',
      status: 'pending',
      updatedAt: new Date(),
      ...row,
    }))
  );
  return Object.values(insertedIds).map(String);
}

async function uniquePendingIndex() {
  const indexes = await WishlistInvite.collection.indexes();
  return indexes.find(
    (i) => i.key.wishlist === 1 && i.key.invitedUser === 1 && Object.keys(i.key).length === 2
  );
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

beforeAll(async () => {
  await connectTestDB();
  // Let the automatic index build finish before we drop what it built.
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  await WishlistInvite.collection.drop().catch(() => {});
});

describe('POST /api/migrations/dedupe-pending-invites', () => {
  it('keeps only the newest pending invite per person per list', async () => {
    const [oldest, newest, middle] = await seed([
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(3), role: 'owner' },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(2) },
    ]);

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, duplicatePairs: 1, invitesDeleted: 2 });

    const left = await WishlistInvite.find({ wishlist: wishlistA, invitedUser: carol }).lean();
    expect(left.map((i) => String(i._id))).toEqual([newest]);
    expect(left[0].role).toBe('owner');
    expect(await WishlistInvite.countDocuments({ _id: { $in: [oldest, middle] } })).toBe(0);
  });

  it('breaks a createdAt tie on _id, keeping the later one', async () => {
    const [first, second] = [oid(), oid()].sort((a, b) => (a.toString() < b.toString() ? -1 : 1));
    await seed([
      { _id: second, wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
      { _id: first, wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
    ]);

    await run();

    const left = await WishlistInvite.find({ wishlist: wishlistA, invitedUser: carol }).lean();
    expect(left.map((i) => String(i._id))).toEqual([second.toString()]);
  });

  it('leaves other pairs and answered invites alone', async () => {
    const untouched = await seed([
      // One pending invite each: nothing to dedupe.
      { wishlist: wishlistA, invitedUser: dave, createdAt: day(1) },
      { wishlist: wishlistB, invitedUser: carol, createdAt: day(1) },
      // Answered invites for the duplicated pair — outside the index, kept as history.
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(5), status: 'declined' },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(6), status: 'accepted' },
    ]);
    const [, keep] = await seed([
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(2) },
    ]);

    const body = await (await run()).json();
    expect(body).toMatchObject({ duplicatePairs: 1, invitesDeleted: 1 });

    const ids = (await WishlistInvite.find().lean()).map((i) => String(i._id)).sort();
    expect(ids).toEqual([...untouched, keep].sort());
  });

  it('builds the unique pending-only index, which then refuses a second pending invite', async () => {
    await seed([
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(2) },
    ]);
    expect(await uniquePendingIndex()).toBeUndefined();

    await run();

    expect(await uniquePendingIndex()).toMatchObject({
      unique: true,
      partialFilterExpression: { status: 'pending' },
    });
    await expect(
      WishlistInvite.create({ wishlist: wishlistA, invitedBy: inviter, invitedUser: carol })
    ).rejects.toMatchObject({ code: 11000 });
    // Partial: answered invites for the same pair still fit alongside the pending one.
    await WishlistInvite.create({
      wishlist: wishlistA,
      invitedBy: inviter,
      invitedUser: carol,
      status: 'declined',
    });
  });

  it('is a no-op on a second run', async () => {
    await seed([
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(1) },
      { wishlist: wishlistA, invitedUser: carol, createdAt: day(2) },
      { wishlist: wishlistB, invitedUser: dave, createdAt: day(1) },
    ]);

    await run();
    const after = await WishlistInvite.find().sort({ _id: 1 }).lean();

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, duplicatePairs: 0, invitesDeleted: 0 });
    expect(await WishlistInvite.find().sort({ _id: 1 }).lean()).toEqual(after);
    expect(await uniquePendingIndex()).toMatchObject({ unique: true });
  });

  it('runs clean on an empty collection', async () => {
    const res = await run();
    expect(await res.json()).toEqual({ success: true, duplicatePairs: 0, invitesDeleted: 0 });
    expect(await uniquePendingIndex()).toMatchObject({ unique: true });
  });
});
