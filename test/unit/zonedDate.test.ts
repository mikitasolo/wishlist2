// Calendar days in a named time zone (WIS-342).
import { describe, it, expect } from 'vitest';
import { dateInZone, isTimeZone, startOfDayInZone } from '@/lib/utils/zonedDate';

describe('isTimeZone', () => {
  it.each(['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Kolkata'])('knows %s', (tz) => {
    expect(isTimeZone(tz)).toBe(true);
  });
  it.each(['', 'Mars/Olympus', 'not a zone', 42, null, 'x'.repeat(65)])('refuses %s', (tz) => {
    expect(isTimeZone(tz)).toBe(false);
  });
});

describe('dateInZone', () => {
  it('is the local calendar date', () => {
    const at = new Date('2030-12-26T05:00:00Z');
    expect(dateInZone(at, 'UTC')).toBe('2030-12-26');
    expect(dateInZone(at, 'America/Los_Angeles')).toBe('2030-12-25');
    expect(dateInZone(at, 'Pacific/Kiritimati')).toBe('2030-12-26');
  });
});

describe('startOfDayInZone', () => {
  it.each([
    ['2030-06-21', 'UTC', '2030-06-21T00:00:00.000Z'],
    ['2030-06-21', 'Europe/Berlin', '2030-06-20T22:00:00.000Z'],
    ['2030-12-21', 'Europe/Berlin', '2030-12-20T23:00:00.000Z'],
    ['2030-06-21', 'Asia/Kolkata', '2030-06-20T18:30:00.000Z'],
    ['2030-06-21', 'America/Los_Angeles', '2030-06-21T07:00:00.000Z'],
    // The days clocks change in Berlin (2030-03-31, 2030-10-27): still midnight.
    ['2030-03-31', 'Europe/Berlin', '2030-03-30T23:00:00.000Z'],
    ['2030-10-27', 'Europe/Berlin', '2030-10-26T22:00:00.000Z'],
  ])('%s in %s begins at %s', (date, tz, expected) => {
    expect(startOfDayInZone(date, tz)?.toISOString()).toBe(expected);
  });

  it('starts a day whose midnight a clock change skips at its first moment', () => {
    // Santiago skips 00:00–01:00 on 2030-09-08 (UTC-4 → UTC-3).
    const start = startOfDayInZone('2030-09-08', 'America/Santiago')!;
    expect(dateInZone(start, 'America/Santiago')).toBe('2030-09-08');
    expect(dateInZone(new Date(start.getTime() - 1000), 'America/Santiago')).toBe('2030-09-07');
  });

  it('is null for a malformed date', () => {
    expect(startOfDayInZone('20300621', 'UTC')).toBeNull();
  });
});
