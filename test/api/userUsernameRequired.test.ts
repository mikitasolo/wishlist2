import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import User from '@/models/User';

// WIS-357: every account has a username (the adapter's `createUser` generates
// one at sign-up), so the model refuses a user without one; nothing downstream
// handles a missing username any more.

beforeAll(async () => {
  await connectTestDB();
  await User.init(); // the unique email and username indexes
});
afterAll(disconnectTestDB);
beforeEach(clearTestDB);

describe('User.username', () => {
  it('is required: a user without one is never saved', async () => {
    for (const username of [undefined, null, '', '   ']) {
      await expect(User.create({ email: 'nameless@example.com', username })).rejects.toThrow(
        /username.*required/i
      );
    }
    expect(await User.countDocuments()).toBe(0);
  });

  it('cannot be cleared from an existing account through the model', async () => {
    const user = await User.create({ email: 'ann@example.com', username: 'ann' });
    user.set('username', undefined);
    await expect(user.save()).rejects.toThrow(/username.*required/i);
    expect((await User.findById(user._id).lean())?.username).toBe('ann');
  });

  it('stays unique', async () => {
    await User.create({ email: 'ann@example.com', username: 'ann' });
    await expect(User.create({ email: 'other@example.com', username: 'ANN' })).rejects.toThrow(
      /duplicate key/
    );
  });
});
