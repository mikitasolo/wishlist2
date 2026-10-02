import { describe, it, expect, afterEach } from 'vitest';
import {
  daysBetween,
  daysUntil,
  draftToOccasion,
  formatCalendarDate,
  formatOccasionLabel,
  isCalendarDate,
  localDateString,
  NO_UPCOMING_OCCASION,
  nextOccurrence,
  occasionKindLabel,
  occasionSortKey,
  occasionToDraft,
  sameOccasion,
  type Occasion,
} from '@/lib/utils/occasion';

describe('isCalendarDate', () => {
  it('accepts real dates, Feb 29 only in a leap year', () => {
    for (const d of ['2026-10-02', '2028-02-29', '2000-02-29', '2026-12-31', '1990-01-01']) {
      expect(isCalendarDate(d)).toBe(true);
    }
  });

  it('refuses days that do not exist, and anything not YYYY-MM-DD', () => {
    for (const d of [
      '2026-02-30',
      '2027-02-29',
      '1900-02-29', // not a leap year: divisible by 100, not by 400
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-1-5',
      '26-01-05',
      '2026-01-05T00:00:00Z',
      ' 2026-01-05',
      '',
    ]) {
      expect(isCalendarDate(d)).toBe(false);
    }
  });

  it('refuses years outside 1900–2999', () => {
    expect(isCalendarDate('1899-12-31')).toBe(false);
    expect(isCalendarDate('1900-01-01')).toBe(true);
    expect(isCalendarDate('2999-12-31')).toBe(true);
    expect(isCalendarDate('3000-01-01')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('is the date itself when it is today', () => {
    expect(nextOccurrence('2026-10-02', null, '2026-10-02')).toBe('2026-10-02');
    expect(nextOccurrence('2026-10-02', 'yearly', '2026-10-02')).toBe('2026-10-02');
  });

  it('is the date itself when it is still ahead, yearly or not', () => {
    expect(nextOccurrence('2026-12-25', null, '2026-10-02')).toBe('2026-12-25');
    expect(nextOccurrence('2027-05-01', 'yearly', '2026-10-02')).toBe('2027-05-01');
  });

  it('is null for a one-off that has passed', () => {
    expect(nextOccurrence('2026-10-01', null, '2026-10-02')).toBeNull();
    expect(nextOccurrence('2020-06-12', null, '2026-10-02')).toBeNull();
  });

  it("falls on this year's day for a yearly date still to come this year", () => {
    expect(nextOccurrence('1990-12-25', 'yearly', '2026-10-02')).toBe('2026-12-25');
  });

  it('is today when a yearly date falls on today in a later year', () => {
    expect(nextOccurrence('1990-10-02', 'yearly', '2026-10-02')).toBe('2026-10-02');
  });

  it('rolls into next year once a yearly date has passed this year', () => {
    expect(nextOccurrence('1990-03-04', 'yearly', '2026-10-02')).toBe('2027-03-04');
    expect(nextOccurrence('2025-10-01', 'yearly', '2026-10-02')).toBe('2027-10-01');
  });

  it('rolls over the new year (Dec 31 → Jan 1)', () => {
    expect(nextOccurrence('2000-01-01', 'yearly', '2026-12-31')).toBe('2027-01-01');
    expect(nextOccurrence('2000-12-31', 'yearly', '2026-12-31')).toBe('2026-12-31');
    expect(nextOccurrence('2000-12-31', 'yearly', '2027-01-01')).toBe('2027-12-31');
  });

  it('keeps Feb 29 in a leap year', () => {
    expect(nextOccurrence('2024-02-29', 'yearly', '2028-01-15')).toBe('2028-02-29');
    expect(nextOccurrence('2028-02-29', null, '2028-02-01')).toBe('2028-02-29');
  });

  it('moves Feb 29 to Feb 28 in a year without one', () => {
    expect(nextOccurrence('2024-02-29', 'yearly', '2026-10-02')).toBe('2027-02-28');
    expect(nextOccurrence('2024-02-29', 'yearly', '2027-02-28')).toBe('2027-02-28');
    // Past the 28th in a non-leap year, the next one is the leap year's 29th.
    expect(nextOccurrence('2024-02-29', 'yearly', '2027-03-01')).toBe('2028-02-29');
  });

  it('is null when a date is not a real one', () => {
    expect(nextOccurrence('2026-02-30', 'yearly', '2026-10-02')).toBeNull();
    expect(nextOccurrence('2026-10-02', 'yearly', 'not-a-date')).toBeNull();
  });
});

describe('daysBetween and daysUntil', () => {
  it('counts whole days, across months, years and DST changes', () => {
    expect(daysBetween('2026-10-02', '2026-10-02')).toBe(0);
    expect(daysBetween('2026-10-02', '2026-10-03')).toBe(1);
    expect(daysBetween('2026-10-03', '2026-10-02')).toBe(-1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // EU clocks go forward on the 29th
    expect(daysBetween('2027-01-01', '2028-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
  });

  it('is 0 on the day itself', () => {
    expect(daysUntil('2026-10-02', null, '2026-10-02')).toBe(0);
    expect(daysUntil('1990-10-02', 'yearly', '2026-10-02')).toBe(0);
  });

  it('is 1 across the new year', () => {
    expect(daysUntil('2000-01-01', 'yearly', '2026-12-31')).toBe(1);
    expect(daysUntil('2027-01-01', null, '2026-12-31')).toBe(1);
  });

  it('counts to next year for a yearly date already passed this year', () => {
    expect(daysUntil('1990-10-01', 'yearly', '2026-10-02')).toBe(364);
  });

  it('counts to Feb 28 in a non-leap year and Feb 29 in a leap one', () => {
    expect(daysUntil('2024-02-29', 'yearly', '2027-02-27')).toBe(1);
    expect(daysUntil('2024-02-29', 'yearly', '2028-02-27')).toBe(2);
  });

  it('is null for a one-off that has passed', () => {
    expect(daysUntil('2026-10-01', null, '2026-10-02')).toBeNull();
  });
});

describe('localDateString', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  // regression guard: `toISOString()` gives the UTC date, a day off for anyone
  // whose local evening or morning straddles UTC midnight.
  it("is the viewer's local date, not the UTC one", () => {
    process.env.TZ = 'America/Los_Angeles';
    // 03:00 UTC on Oct 2 is still the evening of Oct 1 in California.
    expect(localDateString(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-01');

    process.env.TZ = 'Pacific/Auckland';
    // 20:00 UTC on Oct 1 is already the morning of Oct 2 in New Zealand.
    expect(localDateString(new Date('2026-10-01T20:00:00Z'))).toBe('2026-10-02');

    process.env.TZ = 'UTC';
    expect(localDateString(new Date('2026-10-01T20:00:00Z'))).toBe('2026-10-01');
  });

  it('pads months and days', () => {
    process.env.TZ = 'UTC';
    expect(localDateString(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});

describe('formatOccasionLabel', () => {
  const birthday: Occasion = { kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' };

  it('counts down to the next occurrence', () => {
    expect(formatOccasionLabel(birthday, '2026-10-14')).toBe('Birthday · today');
    expect(formatOccasionLabel(birthday, '2026-10-13')).toBe('Birthday · tomorrow');
    expect(formatOccasionLabel(birthday, '2026-10-02')).toBe('Birthday · in 12 days');
    expect(formatOccasionLabel(birthday, '2026-10-15')).toBe('Birthday · in 364 days');
  });

  it('shows a passed one-off as just its kind and date, with no countdown', () => {
    const wedding: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };
    expect(formatOccasionLabel(wedding, '2026-10-02', 'en-US')).toBe('Wedding · Jun 12, 2026');
  });

  it('names each kind briefly, `other` as "Occasion"', () => {
    const on = (kind: Occasion['kind']) =>
      formatOccasionLabel({ kind, date: '2026-12-25', recurrence: null }, '2026-12-25');
    expect(on('holiday')).toBe('Holiday · today');
    expect(on('wedding')).toBe('Wedding · today');
    expect(on('other')).toBe('Occasion · today');
    expect(occasionKindLabel('something-new')).toBe('Occasion');
  });
});

describe('formatCalendarDate', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('formats the calendar day as it is, whatever the time zone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatCalendarDate('2027-01-01', 'en-US')).toBe('Jan 1, 2027');
    process.env.TZ = 'Pacific/Auckland';
    expect(formatCalendarDate('2027-01-01', 'en-US')).toBe('Jan 1, 2027');
  });

  it('gives back a value that is not a date unchanged', () => {
    expect(formatCalendarDate('soon', 'en-US')).toBe('soon');
  });
});

describe('occasionSortKey', () => {
  const today = '2026-10-02';
  const soon: Occasion = { kind: 'holiday', date: '2026-12-25', recurrence: 'yearly' };
  const sooner: Occasion = { kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' };
  const passed: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };

  it('is the days until the occasion, and NO_UPCOMING_OCCASION when nothing is coming up', () => {
    expect(occasionSortKey(sooner, today)).toBe(12);
    expect(occasionSortKey(passed, today)).toBe(NO_UPCOMING_OCCASION);
    expect(occasionSortKey(null, today)).toBe(NO_UPCOMING_OCCASION);
    expect(occasionSortKey(undefined, today)).toBe(NO_UPCOMING_OCCASION);
  });

  it('sorts the soonest first and lists with nothing coming up last, with plain subtraction', () => {
    const lists = [
      { name: 'none', occasion: null },
      { name: 'passed', occasion: passed },
      { name: 'soon', occasion: soon },
      { name: 'sooner', occasion: sooner },
    ];
    const sorted = [...lists].sort(
      (a, b) => occasionSortKey(a.occasion, today) - occasionSortKey(b.occasion, today)
    );
    expect(sorted.map((l) => l.name)).toEqual(['sooner', 'soon', 'none', 'passed']);
  });
});

describe('sameOccasion', () => {
  const birthday: Occasion = { kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' };

  it('compares every field, and treats null and undefined alike as none', () => {
    expect(sameOccasion(birthday, { ...birthday })).toBe(true);
    expect(sameOccasion(birthday, { ...birthday, kind: 'holiday' })).toBe(false);
    expect(sameOccasion(birthday, { ...birthday, date: '1990-10-15' })).toBe(false);
    expect(sameOccasion(birthday, { ...birthday, recurrence: null })).toBe(false);
    expect(sameOccasion(null, undefined)).toBe(true);
    expect(sameOccasion(null, birthday)).toBe(false);
    expect(sameOccasion(birthday, undefined)).toBe(false);
  });
});

describe('occasionToDraft and draftToOccasion', () => {
  it('round-trips an occasion through the settings form', () => {
    const yearly: Occasion = { kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' };
    const once: Occasion = { kind: 'wedding', date: '2027-06-12', recurrence: null };
    expect(occasionToDraft(yearly)).toEqual({ kind: 'birthday', date: '1990-10-14', yearly: true });
    expect(draftToOccasion(occasionToDraft(yearly))).toEqual(yearly);
    expect(draftToOccasion(occasionToDraft(once))).toEqual(once);
  });

  it('reads no occasion as kind "none", and sends it as null', () => {
    expect(occasionToDraft(null)).toEqual({ kind: 'none', date: '', yearly: false });
    expect(occasionToDraft(undefined)).toEqual({ kind: 'none', date: '', yearly: false });
    expect(draftToOccasion({ kind: 'none', date: '2027-06-12', yearly: true })).toBeNull();
  });

  it('sends a kind with no date as it is, for the API to refuse, rather than clearing it', () => {
    expect(draftToOccasion({ kind: 'holiday', date: '', yearly: false })).toEqual({
      kind: 'holiday',
      date: '',
      recurrence: null,
    });
  });
});
