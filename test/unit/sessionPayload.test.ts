import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { SESSION_USER_FIELDS, sessionPayload } from '@/lib/utils/sessionPayload';

const id = new mongoose.Types.ObjectId();
const EXPIRES = new Date('2026-10-31T12:00:00.000Z');

describe('sessionPayload', () => {
  it('takes the account’s own read over the adapter’s row', () => {
    const payload = sessionPayload(
      { id: 'row-id', email: 'me@example.com', username: 'stale', image: 'old.webp' },
      { _id: id, username: 'fresh', image: null, defaultCurrency: 'GBP' },
      EXPIRES
    );

    expect(payload).toEqual({
      user: {
        id: id.toString(),
        email: 'me@example.com',
        username: 'fresh',
        name: undefined,
        image: undefined,
        defaultCurrency: 'GBP',
        currencyChosen: false,
      },
      expires: '2026-10-31T12:00:00.000Z',
    });
  });

  it('falls back to the adapter’s row without a read', () => {
    const payload = sessionPayload(
      { id: 'row-id', email: 'me@example.com', username: 'me', image: 'a.webp', name: 'Me' },
      null,
      EXPIRES
    );

    expect(payload.user).toEqual({
      id: 'row-id',
      email: 'me@example.com',
      username: 'me',
      name: 'Me',
      image: 'a.webp',
      defaultCurrency: 'USD',
      currencyChosen: false,
    });
  });

  it('only ever has the allowlisted fields, whatever the row carries', () => {
    const payload = sessionPayload(
      { id: 'row-id', email: 'me@example.com', sessionToken: 'tok', bio: 'x', privacy: {} },
      null,
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
      null,
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
      },
      expires: 'not-a-date-object',
    });
  });

  // The dashboard's currency prompt reads it; the timestamp itself stays put.
  it('says whether they’ve answered the currency prompt, from either source', () => {
    const at = new Date('2026-10-02T12:00:00.000Z');
    const fromRow = sessionPayload({ id: 'row-id', currencyChosenAt: at }, null, EXPIRES);
    expect(fromRow.user.currencyChosen).toBe(true);
    expect(JSON.stringify(fromRow)).not.toContain('2026-10-02');

    const fromRead = { _id: id, username: 'me', image: null, defaultCurrency: 'USD' };
    expect(
      sessionPayload({ id: 'row-id' }, { ...fromRead, currencyChosenAt: at }, EXPIRES).user
        .currencyChosen
    ).toBe(true);
    // The read wins over the row, as for every other field.
    expect(
      sessionPayload(
        { id: 'row-id', currencyChosenAt: at },
        { ...fromRead, currencyChosenAt: undefined },
        EXPIRES
      ).user.currencyChosen
    ).toBe(false);
    for (const unanswered of [null, undefined]) {
      expect(
        sessionPayload({ id: 'row-id', currencyChosenAt: unanswered }, null, EXPIRES).user
          .currencyChosen
      ).toBe(false);
    }
  });

  it('gives an empty expiry when there is none', () => {
    expect(sessionPayload({ id: 'row-id' }, null, undefined).expires).toBe('');
  });

  // A session whose user has no id would still read as signed in; Auth.js
  // answers a session callback that throws with no session at all.
  it('refuses to build a session without its user’s id', () => {
    expect(() => sessionPayload(undefined, null, EXPIRES)).toThrow('No user id for the session');
    expect(() => sessionPayload({ id: 42, email: 'me@example.com' }, null, EXPIRES)).toThrow();
    expect(() => sessionPayload({ id: '' }, null, EXPIRES)).toThrow();
  });
});
