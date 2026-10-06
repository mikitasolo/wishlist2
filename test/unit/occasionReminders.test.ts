import { describe, it, expect } from 'vitest';
import {
  OCCASION_REMINDER_LEAD_DAYS,
  reminderDayOffsets,
  storedDatesDue,
  storedDatesFor,
} from '@/lib/utils/occasionReminders';
import { BIRTHDAY_LIST_COVER_DAYS, listCoversBirthday } from '@/lib/utils/birthday';
import { addDays, utcDateString } from '@/lib/utils/occasion';

describe('reminderDayOffsets', () => {
  it('is a week ahead with two days to catch up, nearest first', () => {
    expect(OCCASION_REMINDER_LEAD_DAYS).toBe(7);
    expect(reminderDayOffsets()).toEqual([5, 6, 7]);
  });

  it('takes another lead and catch-up (the birthday nudge email’s)', () => {
    expect(reminderDayOffsets(21, 2)).toEqual([19, 20, 21]);
    expect(reminderDayOffsets(3, 0)).toEqual([3]);
  });
});

describe('storedDatesDue', () => {
  it('is every stored date due on one of the offsets, once each', () => {
    expect(storedDatesDue('2026-10-05')).toEqual([
      '2026-10-10',
      '2000-10-10',
      '2026-10-11',
      '2000-10-11',
      '2026-10-12',
      '2000-10-12',
    ]);
    expect(storedDatesDue('2026-10-05', [7, 7])).toEqual(['2026-10-12', '2000-10-12']);
  });
});

describe('listCoversBirthday (WIS-347)', () => {
  it('a Birthday list covers a birthday up to 7 days either side, no further', () => {
    expect(BIRTHDAY_LIST_COVER_DAYS).toBe(7);
    expect(listCoversBirthday('2026-10-12', '2026-10-12')).toBe(true);
    expect(listCoversBirthday('2026-10-05', '2026-10-12')).toBe(true);
    expect(listCoversBirthday('2026-10-19', '2026-10-12')).toBe(true);
    expect(listCoversBirthday('2026-10-04', '2026-10-12')).toBe(false);
    expect(listCoversBirthday('2026-10-20', '2026-10-12')).toBe(false);
    // Across a year end, and nothing for an unreadable date.
    expect(listCoversBirthday('2027-01-02', '2026-12-30')).toBe(true);
    expect(listCoversBirthday('', '2026-10-12')).toBe(false);
  });
});

describe('storedDatesFor', () => {
  it('matches the one-off on that day and the yearly one on its month and day', () => {
    expect(storedDatesFor('2026-10-12')).toEqual(['2026-10-12', '2000-10-12']);
  });

  it('matches a yearly Feb 29 on Feb 28 of a year without one', () => {
    expect(storedDatesFor('2027-02-28')).toEqual(['2027-02-28', '2000-02-28', '2000-02-29']);
    expect(storedDatesFor('2028-02-28')).toEqual(['2028-02-28', '2000-02-28']);
    expect(storedDatesFor('2028-02-29')).toEqual(['2028-02-29', '2000-02-29']);
  });

  it('matches nothing for no date', () => {
    expect(storedDatesFor('')).toEqual([]);
  });
});

describe('addDays / utcDateString', () => {
  it('moves across months and years, and refuses a non-date', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2028-02-27', 2)).toBe('2028-02-29');
    expect(addDays('2026-02-30', 1)).toBeNull();
  });

  it("is the UTC date, whatever the server's zone", () => {
    expect(utcDateString(new Date('2026-10-05T23:30:00-05:00'))).toBe('2026-10-06');
  });
});
