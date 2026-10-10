import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB } from '../db';

// WIS-377's index migration: builds the Wishlist visibility index and drops
// WishlistMember's redundant `{ wishlist: 1 }`, idempotently, behind the
// migration secret.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/migrations/sync-hot-query-indexes/route';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

const post = (secret: string | null = 'test-migration-secret') =>
  POST(
    new NextRequest('http://localhost/api/migrations/sync-hot-query-indexes', {
      method: 'POST',
      headers: secret === null ? {} : { 'X-Migration-Secret': secret },
    })
  );

const keysOf = async (collection: mongoose.Collection) =>
  (await collection.indexes()).map((i) => JSON.stringify(i.key));

beforeAll(async () => {
  await connectTestDB();
  // Let autoIndex finish first, so it can't rebuild anything after a test drops it.
  await Promise.all([Wishlist.init(), WishlistMember.init()]);
});
afterAll(disconnectTestDB);

/** A deployed database before the change: the old index there, the new one not yet. */
async function legacyDatabase() {
  await mongoose.connection.db!.dropDatabase();
  await Wishlist.createCollection();
  await WishlistMember.createCollection();
  await WishlistMember.collection.createIndex({ wishlist: 1, user: 1 }, { unique: true });
  await WishlistMember.collection.createIndex({ wishlist: 1 });
  await WishlistMember.collection.createIndex({ user: 1 });
}

describe('POST /api/migrations/sync-hot-query-indexes', () => {
  beforeEach(legacyDatabase);

  it('builds the visibility index and drops only the redundant member index', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, droppedWishlistMemberIndex: true });

    expect(await keysOf(Wishlist.collection)).toContain('{"visibility":1,"archived":1}');
    const memberKeys = await keysOf(WishlistMember.collection);
    expect(memberKeys).not.toContain('{"wishlist":1}');
    expect(memberKeys).toEqual(
      expect.arrayContaining(['{"wishlist":1,"user":1}', '{"user":1}', '{"_id":1}'])
    );
  });

  it('is idempotent: a second run changes nothing', async () => {
    await post();
    const before = [await keysOf(Wishlist.collection), await keysOf(WishlistMember.collection)];
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, droppedWishlistMemberIndex: false });
    expect([await keysOf(Wishlist.collection), await keysOf(WishlistMember.collection)]).toEqual(
      before
    );
  });

  it('runs on a database with no member collection yet', async () => {
    await mongoose.connection.db!.dropDatabase();
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, droppedWishlistMemberIndex: false });
  });

  it('refuses without the migration secret and changes nothing', async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post('wrong')).status).toBe(401);
    expect(await keysOf(WishlistMember.collection)).toContain('{"wishlist":1}');
    expect(await keysOf(Wishlist.collection)).not.toContain('{"visibility":1,"archived":1}');
  });
});
