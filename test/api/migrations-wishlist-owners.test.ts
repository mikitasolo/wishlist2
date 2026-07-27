import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/migrations/wishlist-owners/route';
import Wishlist from '@/models/Wishlist';
import { isFeaturedBy } from '@/lib/utils/wishlistOwners';

function run() {
  return POST(
    new NextRequest('http://localhost/api/migrations/wishlist-owners', {
      method: 'POST',
      headers: { 'X-Migration-Secret': process.env.MIGRATION_SECRET! },
    })
  );
}

/**
 * The schema shim seeds `owners` from `owner` on save, so a genuinely legacy row
 * has to be written straight to the collection, bypassing mongoose.
 */
async function insertLegacy(fields: Record<string, unknown>) {
  const { insertedId } = await mongoose.connection.collection('wishlists').insertOne({
    name: 'Legacy',
    isPublic: true,
    visibility: 'everyone',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  return insertedId;
}

const alice = new mongoose.Types.ObjectId();
const bob = new mongoose.Types.ObjectId();

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(clearTestDB);

describe('POST /api/migrations/wishlist-owners', () => {
  it('copies the single owner into owners[]', async () => {
    const id = await insertLegacy({ owner: alice });

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, migrated: 1, unowned: 0 });

    const row = await Wishlist.findById(id).lean();
    expect(row!.owners.map(String)).toEqual([alice.toString()]);
  });

  // Additive on purpose: the previously deployed code still authorizes against
  // `owner`, so this has to be safe to run before the new code is live. A later
  // cleanup migration drops the legacy fields.
  it('leaves the legacy fields in place so an old deployment keeps working', async () => {
    const id = await insertLegacy({ owner: alice, featured: true });

    await run();

    const raw = await mongoose.connection.collection('wishlists').findOne({ _id: id });
    expect(raw!.owner).toBeDefined();
    expect(raw!.featured).toBe(true);
  });

  it('turns the legacy featured flag into a per-owner pin', async () => {
    const id = await insertLegacy({ owner: alice, featured: true });

    await run();

    const row = await Wishlist.findById(id).lean();
    expect(row!.featuredBy.map(String)).toEqual([alice.toString()]);
  });

  // Once `owners` is set, the stale legacy flag must stop counting — otherwise an
  // owner who un-pins the list (emptying `featuredBy`) would look pinned again.
  it('ignores the legacy flag once the row is migrated', async () => {
    const id = await insertLegacy({ owner: alice, featured: true });
    await run();

    await Wishlist.updateOne({ _id: id }, { $set: { featuredBy: [] } });
    const row = await Wishlist.findById(id).lean();
    expect(isFeaturedBy(row!, alice.toString())).toBe(false);
  });

  it('leaves an unfeatured list with an empty pin set', async () => {
    const id = await insertLegacy({ owner: alice, featured: false });
    await run();
    const row = await Wishlist.findById(id).lean();
    expect(row!.featuredBy).toEqual([]);
  });

  // Roles live in WishlistMember and owners were never rows there, so the
  // migration must not need to touch anything but the wishlist itself.
  it('does not disturb rows that are already multi-owner', async () => {
    const wl = await Wishlist.create({
      name: 'Family',
      owners: [alice, bob],
      featuredBy: [bob],
      visibility: 'everyone',
    });

    const res = await run();
    expect((await res.json()).migrated).toBe(0);

    const row = await Wishlist.findById(wl._id).lean();
    expect(row!.owners.map(String)).toEqual([alice.toString(), bob.toString()]);
    expect(row!.featuredBy.map(String)).toEqual([bob.toString()]);
  });

  it('is idempotent — a second run finds nothing to do', async () => {
    await insertLegacy({ owner: alice, featured: true });

    await run();
    const second = await run();
    expect(await second.json()).toMatchObject({ scanned: 0, migrated: 0 });
  });

  it('reports rows with no owner to derive rather than writing an invalid doc', async () => {
    const id = await insertLegacy({});

    const res = await run();
    expect(await res.json()).toMatchObject({ migrated: 0, unowned: 1 });

    const raw = await mongoose.connection.collection('wishlists').findOne({ _id: id });
    expect(raw!.owners).toBeUndefined();
  });

  it('401s without the migration secret', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/migrations/wishlist-owners', { method: 'POST' })
    );
    expect(res.status).toBe(401);
  });
});

describe('Wishlist schema — legacy write shape', () => {
  // Transitional shim: anything still writing `{ owner }` must end up as a valid
  // multi-owner document rather than an unowned one.
  it('seeds owners[] from a single owner on save', async () => {
    const wl = await Wishlist.create({ name: 'Legacy write', owner: alice });
    expect(wl.owners.map(String)).toEqual([alice.toString()]);
  });

  it('refuses a wishlist with no owner at all', async () => {
    await expect(Wishlist.create({ name: 'Orphan' })).rejects.toThrow(/at least one owner/i);
  });
});
