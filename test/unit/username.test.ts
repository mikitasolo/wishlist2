import { describe, it, expect, vi, beforeEach } from 'vitest';

// The generator asks the User model whether a candidate is taken; stub that so
// these stay unit tests (no database).
const { users } = vi.hoisted(() => ({ users: { exists: vi.fn() } }));
vi.mock('@/models/User', () => ({ default: users }));

import { USERNAME_REGEX, generateUniqueUsername, isReservedUsername } from '@/lib/utils/username';
import { usernameSchema } from '@/lib/validations';

describe('USERNAME_REGEX', () => {
  it('accepts 3–20 chars starting with a letter', () => {
    expect(USERNAME_REGEX.test('abc')).toBe(true);
    expect(USERNAME_REGEX.test('john_doe99')).toBe(true);
    expect(USERNAME_REGEX.test('a'.repeat(20))).toBe(true);
  });
  it('rejects too-short, too-long, digit-leading, or bad chars', () => {
    expect(USERNAME_REGEX.test('ab')).toBe(false); // < 3
    expect(USERNAME_REGEX.test('a'.repeat(21))).toBe(false); // > 20
    expect(USERNAME_REGEX.test('1abc')).toBe(false); // starts with digit
    expect(USERNAME_REGEX.test('John')).toBe(false); // uppercase
    expect(USERNAME_REGEX.test('a-b')).toBe(false); // hyphen not allowed
  });
});

describe('isReservedUsername', () => {
  it('reserves system words (case-insensitive)', () => {
    expect(isReservedUsername('admin')).toBe(true);
    expect(isReservedUsername('ME')).toBe(true);
    expect(isReservedUsername('settings')).toBe(true);
  });
  it('allows normal names', () => {
    expect(isReservedUsername('mikita')).toBe(false);
  });
});

describe('generateUniqueUsername', () => {
  beforeEach(() => {
    users.exists.mockReset().mockResolvedValue(null);
  });

  it('makes a user_<8 random base36 chars> handle that passes the username rules', async () => {
    const username = await generateUniqueUsername();

    expect(username).toMatch(/^user_[a-z0-9]{8}$/);
    expect(usernameSchema.safeParse(username)).toEqual({ success: true, data: username });
    expect(isReservedUsername(username)).toBe(false);
    expect(users.exists).toHaveBeenCalledWith({ username });
  });

  it('draws a different handle each time', async () => {
    const handles = new Set(
      await Promise.all(Array.from({ length: 200 }, () => generateUniqueUsername()))
    );
    expect(handles.size).toBe(200);
  });

  it('retries until it finds one nobody has', async () => {
    users.exists.mockResolvedValueOnce({ _id: 'a' }).mockResolvedValueOnce({ _id: 'b' });

    const username = await generateUniqueUsername();

    expect(users.exists).toHaveBeenCalledTimes(3);
    const tried = users.exists.mock.calls.map(([filter]) => filter.username);
    expect(tried[2]).toBe(username);
    expect(new Set(tried).size).toBe(3);
  });

  it('gives up with an error, instead of looping forever, if every handle reads as taken', async () => {
    users.exists.mockResolvedValue({ _id: 'taken' });

    await expect(generateUniqueUsername()).rejects.toThrow('Could not generate an unused username');
    expect(users.exists).toHaveBeenCalledTimes(20);
  });

  // regression: generateUniqueUsername built every handle from the email's
  // local part (`email.split('@')[0]`, lowercased and stripped), so by default
  // jane.doe@example.com became @janedoe: a public handle on their profile, in
  // search, members lists, notifications and invite emails, that gave away the
  // email the app promises to keep private.
  it('regression: a generated username carries no part of the email it was generated for', async () => {
    // It takes no input at all, so there is no email for it to leak...
    expect(generateUniqueUsername).toHaveLength(0);

    // ...and even handed one (as the old call sites did), it ignores it.
    const generate = generateUniqueUsername as (email?: string) => Promise<string>;
    const emails = [
      'janet.dorsey@example.com',
      'Margaret_Hamilton42@mailbox.org',
      'kowalski-family@gmail.com',
    ];
    for (const email of emails) {
      const username = await generate(email);
      const [local, domain] = email.toLowerCase().split('@');
      const words = [
        local.replace(/[^a-z0-9_]/g, ''), // the old handle's base
        ...`${local} ${domain}`.split(/[^a-z0-9]+/).filter((w) => w.length >= 4),
      ];
      expect(username).toMatch(/^user_[a-z0-9]{8}$/);
      for (const word of words) expect(username).not.toContain(word);
    }
  });
});
