// How a list's header shows its occasion: the day it next falls on, with its
// weekday, and the countdown to it (`occasionDetails`, lib/utils/occasion.ts).
import { describe, it, expect, afterEach } from 'vitest';
import {
  formatCountdown,
  formatOccasionDay,
  occasionDetails,
  YEARLY_PLACEHOLDER_YEAR,
  type Occasion,
} from '@/lib/utils/occasion';

describe('formatCountdown', () => {
  it('says today, tomorrow, or in how many days', () => {
    expect(formatCountdown(0)).toBe('today');
    expect(formatCountdown(1)).toBe('tomorrow');
    expect(formatCountdown(14)).toBe('in 14 days');
  });
});

describe('formatOccasionDay', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('gives the weekday, day and month, in the locale asked for', () => {
    expect(formatOccasionDay('2026-10-17', { locale: 'en-GB' })).toBe('Sat 17 Oct');
    expect(formatOccasionDay('2026-10-17', { locale: 'en-US' })).toBe('Sat, Oct 17');
  });

  it('adds the year when asked', () => {
    expect(formatOccasionDay('2027-01-02', { withYear: true, locale: 'en-GB' })).toBe(
      'Sat, 2 Jan 2027'
    );
  });

  it('never shifts the day, whatever the time zone', () => {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = zone;
      expect(formatOccasionDay('2026-10-17', { locale: 'en-GB' })).toBe('Sat 17 Oct');
    }
  });

  it('gives back what it can’t read', () => {
    expect(formatOccasionDay('soon')).toBe('soon');
  });
});

describe('occasionDetails', () => {
  const birthday: Occasion = { kind: 'birthday', date: '2000-10-17', recurrence: 'yearly' };

  it('gives a yearly occasion’s next day and the countdown to it', () => {
    expect(occasionDetails(birthday, '2026-10-03', 'en-GB')).toEqual({
      kind: 'Birthday',
      date: 'Sat 17 Oct',
      dateTime: '2026-10-17',
      countdown: 'in 14 days',
    });
    expect(occasionDetails(birthday, '2026-10-17', 'en-GB').countdown).toBe('today');
  });

  it('gives the year of a next occurrence in another year, never the placeholder', () => {
    expect(occasionDetails(birthday, '2026-10-18', 'en-GB')).toEqual({
      kind: 'Birthday',
      date: 'Sun, 17 Oct 2027',
      dateTime: '2027-10-17',
      countdown: 'in 364 days',
    });
    for (const today of ['2026-01-01', '2026-10-17', '2026-12-31', '2027-06-30']) {
      const details = occasionDetails(birthday, today, 'en-GB');
      expect(JSON.stringify(details)).not.toContain(String(YEARLY_PLACEHOLDER_YEAR));
    }
  });

  it('gives a malformed yearly date its kind alone', () => {
    const malformed: Occasion = { kind: 'birthday', date: '2000-02-30', recurrence: 'yearly' };
    expect(occasionDetails(malformed, '2026-10-03', 'en-GB')).toEqual({
      kind: 'Birthday',
      date: null,
      dateTime: null,
      countdown: null,
    });
  });

  it('gives an upcoming one-off its day and countdown, and a passed one its day and year alone', () => {
    const wedding: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };
    expect(occasionDetails(wedding, '2026-06-11', 'en-GB')).toEqual({
      kind: 'Wedding',
      date: 'Fri 12 Jun',
      dateTime: '2026-06-12',
      countdown: 'tomorrow',
    });
    expect(occasionDetails(wedding, '2026-10-03', 'en-GB')).toEqual({
      kind: 'Wedding',
      date: 'Fri, 12 Jun 2026',
      dateTime: '2026-06-12',
      countdown: null,
    });
  });
});
