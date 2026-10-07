import { describe, it, expect } from 'vitest';
import { SESSION_USER_FIELDS, clientSession, sessionPayload } from '@/lib/utils/sessionPayload';

const EXPIRES = new Date('2026-10-31T12:00:00.000Z');

describe('sessionPayload', () => {
  it('builds the session from the adapter’s row', () => {
    const payload = sessionPayload(
      { id: 'row-id', email: 'me@example.com', username: 'me', image: 'a.webp', name: 'Me' },
      EXPIRES
    );

    expect(payload).toEqual({
      expires: '2026-10-31T12:00:00.000Z',
      user: {
        id: 'row-id',
        email: 'me@example.com',
        username: 'me',
        name: 'Me',
        image: 'a.webp',
        defaultCurrency: 'USD',
        currencyChosen: false,
        newAccount: true,
      },
    });
  });

  it('only ever has the allowlisted fields, whatever the row carries', () => {
    const payload = sessionPayload(
      { id: 'row-id', email: 'me@example.com', sessionToken: 'tok', bio: 'x', privacy: {} },
      EXPIRES
    );

    expect(Object.keys(payload).sort()).toEqual(['expires', 'user']);
    expect(Object.keys(payload.user).sort()).toEqual([...SESSION_USER_FIELDS].sort());
    expect(JSON.stringify(payload)).not.toContain('tok');
  });

  it('ignores row values that aren’t strings', () => {
    const payload = sessionPayload(
      {
        id: 'row-id',
        email: null,
        username: { $ne: '' },
        name: ['x'],
        image: 7,
        defaultCurrency: false,
        currencyChosen: true,
        currencyChosenAt: '2026-10-02T12:00:00.000Z',
      },
      'not-a-date-object'
    );

    expect(payload).toEqual({
      user: {
        id: 'row-id',
        email: '',
        username: undefined,
        name: undefined,
        image: undefined,
        defaultCurrency: 'USD',
        currencyChosen: false,
        newAccount: true,
      },
      expires: 'not-a-date-object',
    });
  });

  // The dashboard's currency prompt reads it; the timestamp itself stays put.
  it('says whether they’ve answered the currency prompt, from the row', () => {
    const at = new Date('2026-10-02T12:00:00.000Z');
    const fromRow = sessionPayload({ id: 'row-id', currencyChosenAt: at }, EXPIRES);
    expect(fromRow.user.currencyChosen).toBe(true);
    expect(JSON.stringify(fromRow)).not.toContain('2026-10-02');

    for (const unanswered of [null, undefined]) {
      expect(
        sessionPayload({ id: 'row-id', currencyChosenAt: unanswered }, EXPIRES).user.currencyChosen
      ).toBe(false);
    }
  });

  // WIS-42: the stricter rate-limit tier reads it; the timestamps themselves stay put.
  describe('newAccount', () => {
    const NOW = new Date('2026-10-04T12:00:00.000Z').getTime();
    const HOUR = 60 * 60 * 1000;
    const ago = (ms: number) => new Date(NOW - ms);
    const newAccount = (row: Record<string, unknown>) =>
      sessionPayload({ id: 'row-id', ...row }, EXPIRES, NOW).user.newAccount;

    it('is true for an account created (first signed in) under 24h ago', () => {
      const createdAt = ago(HOUR);
      const payload = sessionPayload({ id: 'row-id', createdAt }, EXPIRES, NOW);
      expect(payload.user.newAccount).toBe(true);
      expect(JSON.stringify(payload)).not.toContain(createdAt.toISOString().slice(0, 13));
    });

    it('is false once the account is 24h old', () => {
      expect(newAccount({ createdAt: ago(25 * HOUR) })).toBe(false);
      expect(newAccount({ createdAt: ago(24 * HOUR) })).toBe(false);
      expect(newAccount({ createdAt: ago(24 * HOUR - 1) })).toBe(true);
    });

    // regression: Auth.js sets `emailVerified` to "now" on every magic-link
    // sign-in of an existing account, so reading it put an old account back on
    // the new-account limits for a day after each sign-in.
    it('regression: an old account that has just signed in again is not new', () => {
      expect(newAccount({ createdAt: ago(365 * 24 * HOUR), emailVerified: ago(60_000) })).toBe(
        false
      );
    });

    it('falls back to emailVerified only for a row without createdAt', () => {
      expect(newAccount({ emailVerified: ago(HOUR) })).toBe(true);
      expect(newAccount({ emailVerified: ago(25 * HOUR) })).toBe(false);
      expect(newAccount({ createdAt: 'not a date', emailVerified: ago(25 * HOUR) })).toBe(false);
    });

    it('is true with neither, or neither readable as a date', () => {
      for (const value of [undefined, null, '2020-01-01T00:00:00.000Z', new Date('x')]) {
        expect(newAccount({ createdAt: value, emailVerified: value })).toBe(true);
      }
    });
  });

  it('gives an empty expiry when there is none', () => {
    expect(sessionPayload({ id: 'row-id' }, undefined).expires).toBe('');
  });

  // A session whose user has no id would still read as signed in; Auth.js
  // answers a session callback that throws with no session at all.
  it('refuses to build a session without its user’s id', () => {
    expect(() => sessionPayload(undefined, EXPIRES)).toThrow('No user id for the session');
    expect(() => sessionPayload({ id: 42, email: 'me@example.com' }, EXPIRES)).toThrow();
    expect(() => sessionPayload({ id: '' }, EXPIRES)).toThrow();
  });
});

describe('clientSession', () => {
  const expires = EXPIRES.toISOString();

  it('keeps exactly the allowlisted fields and expires', () => {
    const session = sessionPayload(
      { id: 'u1', email: 'me@example.com', username: 'me', defaultCurrency: 'EUR' },
      EXPIRES
    );
    expect(clientSession(session)).toEqual(session);
  });

  // The home page hands this to the browser in its HTML: a raw database row
  // (Auth.js's `{ ...sessionRow, user: userRow }`) must lose everything else,
  // the session token above all, even if `auth()` ever returned one.
  it('drops a session token, a raw row’s fields and anything else', () => {
    const raw = {
      sessionToken: 'secret-token',
      userId: 'u1',
      expires,
      user: {
        id: 'u1',
        email: 'me@example.com',
        username: 'me',
        emailVerified: new Date(),
        currencyChosenAt: new Date(),
        privacy: { profileVisibility: 'friends' },
        _id: 'u1',
      },
    };
    const out = clientSession(raw as never);
    expect(out).toEqual({ user: { id: 'u1', email: 'me@example.com', username: 'me' }, expires });
    expect(JSON.stringify(out)).not.toContain('secret-token');
  });

  it('is null for no session, or one without a user id', () => {
    expect(clientSession(null)).toBeNull();
    expect(clientSession(undefined)).toBeNull();
    expect(clientSession({ user: { email: 'me@example.com' }, expires } as never)).toBeNull();
    expect(clientSession({ user: { id: '' }, expires } as never)).toBeNull();
  });
});

describe('sessionPayload: the profile birthday (WIS-323)', () => {
  it('never carries it, even from a row that has it', () => {
    const payload = sessionPayload(
      {
        id: 'row-id',
        email: 'me@example.com',
        birthday: '2000-03-14',
        privacy: { birthdayVisibility: 'everyone' },
      },
      EXPIRES
    );
    expect(JSON.stringify(payload)).not.toMatch(/birthday|03-14/);
  });
});
