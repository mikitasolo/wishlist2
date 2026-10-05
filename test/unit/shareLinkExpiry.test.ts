import { describe, it, expect } from 'vitest';
import {
  dayAfterOccasion,
  defaultExpiryPreset,
  defaultLevel,
  expiryDateString,
  expiryFor,
  expiryPresetsFor,
  formatLinkExpiry,
  isLinkExpired,
  isRevival,
  startOfLocalDay,
} from '@/lib/utils/shareLinkExpiry';
import type { Occasion } from '@/lib/utils/occasion';

// Share links' expiry presets and defaults (WIS-335). A date means "from the
// start of that local day".

const now = new Date(2026, 5, 1, 15, 30); // 1 Jun 2026, 15:30 local
const today = '2026-06-01';
const birthday: Occasion = { kind: 'birthday', date: '2000-06-12', recurrence: 'yearly' };
const pastWedding: Occasion = { kind: 'wedding', date: '2026-05-01', recurrence: null };
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe('dayAfterOccasion', () => {
  it('is the day after the next occurrence', () => {
    expect(dayAfterOccasion(birthday, today)).toBe('2026-06-13');
    expect(dayAfterOccasion(birthday, '2026-06-20')).toBe('2027-06-13');
  });
  it('is the day after when the occasion is today', () => {
    expect(dayAfterOccasion(birthday, '2026-06-12')).toBe('2026-06-13');
  });
  it('is null without an occasion ahead', () => {
    expect(dayAfterOccasion(null, today)).toBeNull();
    expect(dayAfterOccasion(pastWedding, today)).toBeNull();
  });
});

describe('presets and defaults', () => {
  it('offers Day after the occasion only with one ahead', () => {
    expect(expiryPresetsFor(birthday, today)).toEqual([
      'never',
      'week',
      'month',
      'occasion',
      'custom',
    ]);
    expect(expiryPresetsFor(pastWedding, today)).not.toContain('occasion');
    expect(expiryPresetsFor(undefined, today)).not.toContain('occasion');
  });
  it('defaults a Join link to the day after the occasion, else Never; a View link to Never', () => {
    expect(defaultExpiryPreset('join', true)).toBe('occasion');
    expect(defaultExpiryPreset('join', false)).toBe('never');
    expect(defaultExpiryPreset('view', true)).toBe('never');
  });
  it('defaults the level to Join on a Public list only', () => {
    expect(defaultLevel('everyone')).toBe('join');
    expect(defaultLevel('friends')).toBe('view');
    expect(defaultLevel('private')).toBe('view');
  });
});

describe('expiryFor', () => {
  const ctx = { now, today, occasion: birthday };
  it('gives null for Never', () => {
    expect(expiryFor('never', ctx)).toBeNull();
  });
  it('counts a week and a month from now', () => {
    expect(expiryFor('week', ctx)).toBe(new Date(now.getTime() + 7 * 864e5).toISOString());
    expect(expiryFor('month', ctx)).toBe(new Date(2026, 6, 1, 15, 30).toISOString());
  });
  it('keeps a month to the last day of a shorter one', () => {
    const jan31 = new Date(2026, 0, 31, 9);
    expect(expiryFor('month', { now: jan31, today: '2026-01-31' })).toBe(
      new Date(2026, 1, 28, 9).toISOString()
    );
  });
  it('starts the day after the occasion at local midnight', () => {
    expect(expiryFor('occasion', ctx)).toBe(local(2026, 6, 13));
    expect(expiryFor('occasion', { ...ctx, occasion: null })).toBeUndefined();
  });
  it('takes a custom date after today only', () => {
    expect(expiryFor('custom', { ...ctx, customDate: '2026-07-04' })).toBe(local(2026, 7, 4));
    expect(expiryFor('custom', { ...ctx, customDate: today })).toBeUndefined();
    expect(expiryFor('custom', { ...ctx, customDate: '2026-05-31' })).toBeUndefined();
    expect(expiryFor('custom', { ...ctx, customDate: '' })).toBeUndefined();
    expect(expiryFor('custom', { ...ctx, customDate: '2026-02-30' })).toBeUndefined();
  });
  it('round-trips a date through the Custom field', () => {
    expect(expiryDateString(local(2026, 7, 4))).toBe('2026-07-04');
    expect(startOfLocalDay('nope')).toBeNull();
  });
});

describe('expiry state', () => {
  const expired = { expiresAt: new Date(now.getTime() - 1000).toISOString() };
  const live = { expiresAt: local(2026, 6, 12) };
  it('tells an expired link from a live one', () => {
    expect(isLinkExpired(expired, now)).toBe(true);
    expect(isLinkExpired(live, now)).toBe(false);
    expect(isLinkExpired({ expiresAt: null }, now)).toBe(false);
  });
  it('calls a later expiry on an expired link a revival', () => {
    expect(isRevival(expired, local(2026, 7, 1), now)).toBe(true);
    expect(isRevival(expired, null, now)).toBe(true);
    expect(isRevival(expired, new Date(now.getTime() - 5000).toISOString(), now)).toBe(false);
    // A live link isn't brought back by anything.
    expect(isRevival(live, local(2026, 7, 1), now)).toBe(false);
  });
  it('formats the row’s expiry', () => {
    expect(formatLinkExpiry({ expiresAt: null }, now, 'en-GB')).toBeNull();
    expect(formatLinkExpiry(expired, now, 'en-GB')).toBe('Expired');
    expect(formatLinkExpiry(live, now, 'en-GB')).toBe('Expires 12 Jun');
    expect(formatLinkExpiry({ expiresAt: local(2027, 1, 3) }, now, 'en-GB')).toBe(
      'Expires 3 Jan 2027'
    );
  });
});
