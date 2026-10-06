import { describe, it, expect } from 'vitest';
import {
  BIRTHDAY_NUDGE_LEAD_DAYS,
  birthdayCountdown,
  birthdayNudge,
  birthdayNudgeDue,
  birthdayNudgeTitle,
  hasBirthdayListComing,
  olderBirthdayLists,
  type BirthdayRuleList,
} from '@/lib/utils/birthdayNudge';
import { birthdayEmailDayOffsets } from '@/lib/utils/birthdayNudgeEmails';
import { utcDateString, type Occasion } from '@/lib/utils/occasion';

// The nudge to make a list before your own birthday (WIS-344): from 21 days
// before until the day itself, unless a Birthday list of yours is coming.

const BIRTHDAY = '2000-10-27'; // stored on the placeholder year

const birthdayList = (date: string, extra: Partial<BirthdayRuleList> = {}): BirthdayRuleList => ({
  occasion: { kind: 'birthday', date, recurrence: null },
  ...extra,
});
const yearly = (kind: Occasion['kind'], date: string): BirthdayRuleList => ({
  occasion: { kind, date, recurrence: 'yearly' },
});

describe('birthdayNudgeDue: the window', () => {
  it('opens 21 days before and closes after the day itself', () => {
    expect(BIRTHDAY_NUDGE_LEAD_DAYS).toBe(21);
    expect(birthdayNudgeDue(BIRTHDAY, '2026-10-05')).toBeNull(); // 22 days
    expect(birthdayNudgeDue(BIRTHDAY, '2026-10-06')).toEqual({
      occurrence: '2026-10-27',
      days: 21,
    });
    expect(birthdayNudgeDue(BIRTHDAY, '2026-10-27')).toEqual({ occurrence: '2026-10-27', days: 0 });
    // The day after: next year's is far off.
    expect(birthdayNudgeDue(BIRTHDAY, '2026-10-28')).toBeNull();
  });

  it('crosses into next year', () => {
    expect(birthdayNudgeDue('2000-01-05', '2026-12-20')).toEqual({
      occurrence: '2027-01-05',
      days: 16,
    });
  });

  it('is nothing without a birthday, a day or with an unreadable one', () => {
    expect(birthdayNudgeDue(null, '2026-10-20')).toBeNull();
    expect(birthdayNudgeDue('', '2026-10-20')).toBeNull();
    expect(birthdayNudgeDue(BIRTHDAY, null)).toBeNull();
    expect(birthdayNudgeDue('2000-13-40', '2026-10-20')).toBeNull();
  });

  it('puts Feb 29 on Feb 28 in a year without one, and on Feb 29 in a leap year', () => {
    expect(birthdayNudgeDue('2000-02-29', '2027-02-07')).toEqual({
      occurrence: '2027-02-28',
      days: 21,
    });
    expect(birthdayNudgeDue('2000-02-29', '2028-02-08')).toEqual({
      occurrence: '2028-02-29',
      days: 21,
    });
  });

  it('counts from whichever date it is given: the viewer’s local one, or the UTC one in the cron', () => {
    // 23:30 UTC on Oct 5 is already Oct 6 in Warsaw (UTC+2), but not in UTC.
    const instant = new Date('2026-10-05T23:30:00Z');
    expect(birthdayNudgeDue(BIRTHDAY, utcDateString(instant))).toBeNull();
    // The browser's local date there (what `useLocalToday` gives) is in the window.
    expect(birthdayNudgeDue(BIRTHDAY, '2026-10-06')?.days).toBe(21);
  });
});

describe('hasBirthdayListComing: any Birthday list of yours', () => {
  const ON = '2026-10-27';

  it('is false with no lists, or none with a Birthday occasion', () => {
    expect(hasBirthdayListComing([], ON)).toBe(false);
    expect(
      hasBirthdayListComing(
        [{ occasion: null }, {}, yearly('wedding', '2000-10-27'), yearly('other', '2000-10-25')],
        ON
      )
    ).toBe(false);
  });

  it('is true with one Birthday list on the day, or dated to a party a few days off', () => {
    expect(hasBirthdayListComing([birthdayList('2026-10-27')], ON)).toBe(true);
    expect(hasBirthdayListComing([birthdayList('2026-10-24')], ON)).toBe(true);
    expect(hasBirthdayListComing([birthdayList('2026-10-31')], ON)).toBe(true);
    // A yearly one, on the day or a few days off.
    expect(hasBirthdayListComing([yearly('birthday', '2000-10-27')], ON)).toBe(true);
    expect(hasBirthdayListComing([yearly('birthday', '2000-11-01')], ON)).toBe(true);
  });

  it('counts a list from the start of the lead window to a week after the birthday', () => {
    expect(hasBirthdayListComing([birthdayList('2026-10-06')], ON)).toBe(true);
    expect(hasBirthdayListComing([birthdayList('2026-10-05')], ON)).toBe(false);
    expect(hasBirthdayListComing([birthdayList('2026-11-03')], ON)).toBe(true);
    expect(hasBirthdayListComing([birthdayList('2026-11-04')], ON)).toBe(false);
    // Last year's, long passed, doesn't count.
    expect(hasBirthdayListComing([birthdayList('2025-10-27')], ON)).toBe(false);
  });

  it('is true when any one of several is coming, whatever the others', () => {
    const lists = [
      birthdayList('2025-10-27'),
      yearly('wedding', '2000-10-27'),
      birthdayList('2026-10-26', { archived: true }),
      yearly('birthday', '2000-10-25'),
    ];
    expect(hasBirthdayListComing(lists, ON)).toBe(true);
    expect(hasBirthdayListComing(lists.slice(0, 3), ON)).toBe(false);
  });

  it('never counts an archived one', () => {
    expect(hasBirthdayListComing([birthdayList('2026-10-27', { archived: true })], ON)).toBe(false);
  });

  it('counts a Feb 29 Birthday list for a Feb 28 birthday in a year without one', () => {
    expect(hasBirthdayListComing([yearly('birthday', '2000-02-29')], '2027-02-28')).toBe(true);
  });
});

describe('birthdayNudge', () => {
  it('nudges in the window with no Birthday list coming, and not once one is', () => {
    expect(birthdayNudge(BIRTHDAY, [], '2026-10-06')).toEqual({
      occurrence: '2026-10-27',
      days: 21,
    });
    expect(birthdayNudge(BIRTHDAY, [birthdayList('2026-10-25')], '2026-10-06')).toBeNull();
    // Co-owned lists are the caller's to pass in: the rule reads whatever it's given.
    expect(birthdayNudge(BIRTHDAY, [birthdayList('2026-10-25')], '2026-10-05')).toBeNull();
    expect(birthdayNudge(null, [], '2026-10-06')).toBeNull();
  });
});

describe('the copy', () => {
  it.each([
    [21, 'in 3 weeks'],
    [14, 'in 2 weeks'],
    [7, 'in a week'],
    [10, 'in 10 days'],
    [1, 'tomorrow'],
    [0, 'today'],
  ])('%i days reads "%s"', (days, text) => {
    expect(birthdayCountdown(days)).toBe(text);
  });

  it('heads the row and the email', () => {
    expect(birthdayNudgeTitle(21)).toBe('Your birthday is in 3 weeks');
  });
});

describe('birthdayEmailDayOffsets', () => {
  it('is three weeks ahead with two days of catch-up, nearest first', () => {
    expect(birthdayEmailDayOffsets()).toEqual([19, 20, 21]);
  });
});

describe('olderBirthdayLists (WIS-348)', () => {
  const birthday = { kind: 'birthday' as const };
  it('keeps only the Birthday lists, in the order given, as id and name', () => {
    expect(
      olderBirthdayLists([
        { _id: 'a', name: '2026', occasion: birthday, archived: false },
        { _id: 'b', name: 'Trip', occasion: { kind: 'other' as const } },
        { _id: 'c', name: '2025', occasion: birthday, archived: true },
        { _id: 'd', name: 'None', occasion: null },
        { _id: 'e', name: 'Unset' },
      ])
    ).toEqual([
      { _id: 'a', name: '2026' },
      { _id: 'c', name: '2025' },
    ]);
  });
  it('puts the newest created first whatever the order given', () => {
    expect(
      olderBirthdayLists([
        { _id: 'old', name: 'Old', occasion: birthday, createdAt: '2023-01-01T00:00:00Z' },
        { _id: 'new', name: 'New', occasion: birthday, createdAt: '2025-01-01T00:00:00Z' },
      ]).map((w) => w._id)
    ).toEqual(['new', 'old']);
  });
  it('is empty with no lists', () => {
    expect(olderBirthdayLists(null)).toEqual([]);
    expect(olderBirthdayLists([])).toEqual([]);
  });
});
