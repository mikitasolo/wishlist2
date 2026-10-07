import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/utils/username', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/username')>();
  return { ...actual, generateUniqueUsername: generate };
});

import User from '@/models/User';
import { POST } from '@/app/api/migrations/backfill-usernames/route';

const SECRET = 'test-migration-secret';
let realGenerate: () => Promise<string>;

function run(query = '') {
  return POST(
    new NextRequest(`http://localhost/api/migrations/backfill-usernames${query}`, {
      method: 'POST',
      headers: { 'X-Migration-Secret': SECRET },
    })
  );
}

/** Raw inserts, so the rows keep exactly the shape a legacy account has. */
async function insertRaw(doc: Record<string, unknown>) {
  const _id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id, ...doc });
  return _id;
}

async function usernameOf(id: mongoose.Types.ObjectId) {
  const row = await User.collection.findOne({ _id: id });
  return row?.username;
}

/** One account per "no username" shape, plus one that has a name. */
async function seedLegacy() {
  return {
    missing: await insertRaw({ email: 'missing@example.com' }),
    nulled: await insertRaw({ email: 'nulled@example.com', username: null }),
    empty: await insertRaw({ email: 'empty@example.com', username: '' }),
    named: await insertRaw({ email: 'named@example.com', username: 'alice' }),
  };
}

describe('POST /api/migrations/backfill-usernames', () => {
  beforeAll(async () => {
    await connectTestDB();
    await User.createIndexes();
    const actual =
      await vi.importActual<typeof import('@/lib/utils/username')>('@/lib/utils/username');
    realGenerate = actual.generateUniqueUsername;
    process.env.MIGRATION_SECRET = SECRET;
  });
  afterAll(async () => {
    await disconnectTestDB();
  });
  beforeEach(async () => {
    await clearTestDB();
    generate.mockReset();
    generate.mockImplementation(() => realGenerate());
  });

  it('refuses a request without the migration secret', async () => {
    await seedLegacy();
    const res = await POST(
      new NextRequest('http://localhost/api/migrations/backfill-usernames', { method: 'POST' })
    );
    expect(res.status).toBe(401);
    expect(await User.countDocuments({ username: 'alice' })).toBe(1);
    expect(await User.countDocuments({ $or: [{ username: null }, { username: '' }] })).toBe(3);
  });

  it('gives missing, null and empty usernames a generated one and leaves named users alone', async () => {
    const ids = await seedLegacy();

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      dryRun: false,
      matched: 3,
      changed: 3,
      skipped: 0,
      failed: 0,
    });

    const names = await Promise.all([ids.missing, ids.nulled, ids.empty].map(usernameOf));
    for (const name of names) expect(name).toMatch(/^user_[a-z0-9]+$/);
    expect(new Set(names).size).toBe(3);
    expect(await usernameOf(ids.named)).toBe('alice');
  });

  it('changes 0 rows on a second run', async () => {
    const ids = await seedLegacy();
    await run();
    const before = await Promise.all(Object.values(ids).map(usernameOf));

    const res = await run();
    expect(await res.json()).toEqual({
      success: true,
      dryRun: false,
      matched: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await Promise.all(Object.values(ids).map(usernameOf))).toEqual(before);
  });

  it('only counts on a dry run and writes nothing', async () => {
    const ids = await seedLegacy();

    const res = await run('?dryRun=1');
    expect(await res.json()).toEqual({
      success: true,
      dryRun: true,
      matched: 3,
      changed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await usernameOf(ids.missing)).toBeUndefined();
    expect(await usernameOf(ids.nulled)).toBeNull();
    expect(await usernameOf(ids.empty)).toBe('');
  });

  it('draws again when the generated name was taken between the check and the write', async () => {
    const id = await insertRaw({ email: 'legacy@example.com' });
    await insertRaw({ email: 'other@example.com', username: 'user_taken000' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    generate.mockResolvedValueOnce('user_taken000').mockResolvedValueOnce('user_fresh000');

    const res = await run();
    expect(await res.json()).toMatchObject({ matched: 1, changed: 1, failed: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await usernameOf(id)).toBe('user_fresh000');
    // The duplicate-key error quotes the clashing name: nothing is logged.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('counts an account failed after losing the race on every attempt, and a re-run finishes it', async () => {
    const id = await insertRaw({ email: 'legacy@example.com' });
    await insertRaw({ email: 'other@example.com', username: 'user_taken000' });
    generate.mockResolvedValue('user_taken000');

    const res = await run();
    expect(await res.json()).toMatchObject({ matched: 1, changed: 0, failed: 1 });
    expect(await usernameOf(id)).toBeUndefined();

    generate.mockReset();
    generate.mockImplementation(() => realGenerate());
    expect(await (await run()).json()).toMatchObject({ matched: 1, changed: 1, failed: 0 });
    expect(await usernameOf(id)).toMatch(/^user_/);
  });

  it('keeps a username a sign-in gave the account after the run read it', async () => {
    const id = await insertRaw({ email: 'legacy@example.com' });
    // The session callback's backfillUsername wins the race: it names the
    // account after this run matched it but before this run's write.
    generate.mockImplementationOnce(async () => {
      await User.collection.updateOne({ _id: id }, { $set: { username: 'user_signin00' } });
      return 'user_migrate0';
    });

    const res = await run();
    expect(await res.json()).toMatchObject({ matched: 1, changed: 0, skipped: 1, failed: 0 });
    expect(await usernameOf(id)).toBe('user_signin00');
  });
});
