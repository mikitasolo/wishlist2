import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { format } from 'node:util';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import User from '@/models/User';
import { createUserAccount } from '@/lib/utils/userAccount';

/**
 * The adapter's createUser: the one place a new account is made, on its first
 * verified sign-in (lib/authAdapter.ts).
 */

const EMAIL = 'jane.doe@example.com';
/** What Auth.js hands createUser for a first email sign-in: a throwaway id, the address, now-verified. */
const signUp = (email = EMAIL) => ({
  id: crypto.randomUUID(),
  email,
  emailVerified: new Date('2026-10-01T12:00:00Z'),
});

beforeAll(async () => {
  await connectTestDB();
  await User.init(); // the unique email and username indexes
});
afterAll(disconnectTestDB);
beforeEach(clearTestDB);

describe('createUserAccount', () => {
  it('creates the account with a generated username and the model defaults', async () => {
    const created = await createUserAccount(signUp());

    const row = await User.findOne({ email: EMAIL }).lean();
    expect(row).not.toBeNull();
    expect(created).toEqual({
      id: row!._id.toString(),
      email: EMAIL,
      emailVerified: new Date('2026-10-01T12:00:00Z'),
      image: null,
    });
    expect(row!.username).toMatch(/^user_[a-z0-9]{8}$/);
    expect(row!.emailVerified).toEqual(new Date('2026-10-01T12:00:00Z'));
    // Same shape as any other account, so lean reads and filters on these work.
    expect(row!.defaultCurrency).toBe('USD');
    expect(row!.privacy).toEqual({
      searchable: true,
      whoCanInvite: 'everyone',
      profileVisibility: 'everyone',
      birthdayVisibility: 'friends',
    });
    // No birthday until they add one (WIS-323).
    expect(row!.birthday ?? null).toBeNull();
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  // regression: new accounts were given `email.split('@')[0]` as their public
  // handle (jane.doe@example.com → @janedoe).
  it('regression: the new account’s username carries no part of its email', async () => {
    await createUserAccount(signUp());

    const { username } = (await User.findOne({ email: EMAIL }).lean())!;
    for (const part of ['janedoe', 'jane', 'example']) expect(username).not.toContain(part);
  });

  it('stores the email lowercased', async () => {
    await createUserAccount(signUp('Jane.Doe@Example.com'));
    expect(await User.countDocuments({ email: EMAIL })).toBe(1);
  });

  // Two links clicked at once for a new address both get here; the loser's
  // insert trips the unique email index.
  it('resolves a sign-up that lost the race to the account that won it', async () => {
    const winner = await User.create({ email: EMAIL, username: 'already_here' });

    const created = await createUserAccount(signUp());

    expect(created.id).toBe(winner._id.toString());
    expect(await User.countDocuments({})).toBe(1);
  });

  it('two concurrent sign-ups for one email end up as one account', async () => {
    const [a, b] = await Promise.all([createUserAccount(signUp()), createUserAccount(signUp())]);

    expect(a.id).toBe(b.id);
    expect(await User.countDocuments({ email: EMAIL })).toBe(1);
  });

  /** The error the unique username index gives an insert that lost a race for `username`. */
  const usernameTaken = (username: string) =>
    Object.assign(
      new Error(
        `E11000 duplicate key error collection: test.users index: username_1 dup key: { username: "${username}" }`
      ),
      { code: 11000, keyPattern: { username: 1 }, keyValue: { username } }
    );

  // Another sign-up can take the generated username between its check and this insert.
  it('draws another username when the generated one was taken in the meantime', async () => {
    const insert = vi.spyOn(User, 'create').mockRejectedValueOnce(usernameTaken('user_clash000'));

    const created = await createUserAccount(signUp());

    expect(insert).toHaveBeenCalledTimes(2);
    const row = await User.findById(created.id).lean();
    expect(row!.email).toBe(EMAIL);
    expect(row!.username).toMatch(/^user_[a-z0-9]{8}$/);
    insert.mockRestore();
  });

  // Auth.js logs every adapter error whole (cause and all), and a MongoDB
  // duplicate-key error quotes the clashing value.
  it('gives up on a username clash that keeps happening, without the value it clashed on', async () => {
    const insert = vi.spyOn(User, 'create').mockRejectedValue(usernameTaken('user_clash000'));

    const failure = await createUserAccount(signUp()).catch((e: unknown) => e);

    expect(insert).toHaveBeenCalledTimes(3);
    expect(failure).toBeInstanceOf(Error);
    const printed = format(failure);
    expect(printed).toContain('duplicate username');
    expect(printed).not.toContain('user_clash000');
    expect(printed).not.toContain(EMAIL);
    insert.mockRestore();
  });

  it('fails without the address when the email clashed but the other account is gone', async () => {
    const insert = vi.spyOn(User, 'create').mockRejectedValueOnce(
      Object.assign(new Error(`E11000 duplicate key error dup key: { email: "${EMAIL}" }`), {
        code: 11000,
        keyPattern: { email: 1 },
        keyValue: { email: EMAIL },
      })
    );

    const failure = await createUserAccount(signUp()).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(format(failure)).toContain('duplicate email');
    expect(format(failure)).not.toContain(EMAIL);
    insert.mockRestore();
  });

  it('passes any other database error through', async () => {
    const outage = new Error('connection refused');
    const insert = vi.spyOn(User, 'create').mockRejectedValueOnce(outage);

    await expect(createUserAccount(signUp())).rejects.toBe(outage);
    insert.mockRestore();
  });
});
