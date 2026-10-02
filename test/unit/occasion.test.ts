import { describe, it, expect, afterEach } from 'vitest';
import {
  daysBetween,
  daysInYearlyMonth,
  daysUntil,
  draftToOccasion,
  missingFromDraft,
  occasionChange,
  formatCalendarDate,
  formatOccasionLabel,
  isCalendarDate,
  localDateString,
  NO_UPCOMING_OCCASION,
  nextOccurrence,
  normalizeOccasionDate,
  occasionKindLabel,
  occasionSortKey,
  occasionToDraft,
  sameOccasion,
  setDraftMonth,
  setDraftYearly,
  YEARLY_PLACEHOLDER_YEAR,
  type Occasion,
  type OccasionDraft,
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

describe('normalizeOccasionDate', () => {
  it('is 2000, a leap year, that yearly dates are stored on', () => {
    expect(YEARLY_PLACEHOLDER_YEAR).toBe(2000);
  });

  it("replaces a yearly date's year, whatever it was, with the placeholder", () => {
    expect(normalizeOccasionDate('1990-05-14', 'yearly')).toBe('2000-05-14');
    expect(normalizeOccasionDate('2027-12-25', 'yearly')).toBe('2000-12-25');
    expect(normalizeOccasionDate('2000-05-14', 'yearly')).toBe('2000-05-14');
    expect(normalizeOccasionDate('0001-01-01', 'yearly')).toBe('2000-01-01');
  });

  it("checks a yearly date's month and day against the leap year: Feb 29 passes, Feb 30 doesn't", () => {
    expect(normalizeOccasionDate('1990-02-29', 'yearly')).toBe('2000-02-29');
    expect(normalizeOccasionDate('2027-02-29', 'yearly')).toBe('2000-02-29');
    expect(normalizeOccasionDate('1990-02-30', 'yearly')).toBeNull();
    expect(normalizeOccasionDate('1990-04-31', 'yearly')).toBeNull();
    expect(normalizeOccasionDate('1990-13-01', 'yearly')).toBeNull();
    expect(normalizeOccasionDate('05-14', 'yearly')).toBeNull();
    expect(normalizeOccasionDate('', 'yearly')).toBeNull();
  });

  it("keeps a one-off's real date, checked against its own year", () => {
    expect(normalizeOccasionDate('2027-06-12', null)).toBe('2027-06-12');
    expect(normalizeOccasionDate('2028-02-29', null)).toBe('2028-02-29');
    expect(normalizeOccasionDate('2027-02-29', null)).toBeNull();
    expect(normalizeOccasionDate('2026-02-30', null)).toBeNull();
    // A one-off in the past is still a real date.
    expect(normalizeOccasionDate('2020-06-12', null)).toBe('2020-06-12');
  });
});

describe('nextOccurrence', () => {
  it('is the date itself when it is today', () => {
    expect(nextOccurrence('2026-10-02', null, '2026-10-02')).toBe('2026-10-02');
    expect(nextOccurrence('2000-10-02', 'yearly', '2026-10-02')).toBe('2026-10-02');
  });

  it('is a one-off date itself while it is still ahead', () => {
    expect(nextOccurrence('2026-12-25', null, '2026-10-02')).toBe('2026-12-25');
    expect(nextOccurrence('2031-05-01', null, '2026-10-02')).toBe('2031-05-01');
  });

  it('is null for a one-off that has passed', () => {
    expect(nextOccurrence('2026-10-01', null, '2026-10-02')).toBeNull();
    expect(nextOccurrence('2020-06-12', null, '2026-10-02')).toBeNull();
  });

  it("falls on this year's day for a yearly date still to come this year", () => {
    expect(nextOccurrence('2000-12-25', 'yearly', '2026-10-02')).toBe('2026-12-25');
  });

  it('ignores a yearly date’s year, even one still ahead', () => {
    expect(nextOccurrence('2027-12-25', 'yearly', '2026-10-02')).toBe('2026-12-25');
    expect(nextOccurrence('1990-12-25', 'yearly', '2026-10-02')).toBe('2026-12-25');
  });

  it('rolls into next year once a yearly date has passed this year', () => {
    expect(nextOccurrence('2000-03-04', 'yearly', '2026-10-02')).toBe('2027-03-04');
    expect(nextOccurrence('2000-10-01', 'yearly', '2026-10-02')).toBe('2027-10-01');
  });

  it('rolls over the new year (Dec 31 → Jan 1)', () => {
    expect(nextOccurrence('2000-01-01', 'yearly', '2026-12-31')).toBe('2027-01-01');
    expect(nextOccurrence('2000-12-31', 'yearly', '2026-12-31')).toBe('2026-12-31');
    expect(nextOccurrence('2000-12-31', 'yearly', '2027-01-01')).toBe('2027-12-31');
  });

  it('keeps Feb 29 in a leap year', () => {
    expect(nextOccurrence('2000-02-29', 'yearly', '2028-01-15')).toBe('2028-02-29');
    expect(nextOccurrence('2028-02-29', null, '2028-02-01')).toBe('2028-02-29');
  });

  it('moves Feb 29 to Feb 28 in a year without one', () => {
    expect(nextOccurrence('2000-02-29', 'yearly', '2026-10-02')).toBe('2027-02-28');
    expect(nextOccurrence('2000-02-29', 'yearly', '2027-02-28')).toBe('2027-02-28');
    // Past the 28th in a non-leap year, the next one is the leap year's 29th.
    expect(nextOccurrence('2000-02-29', 'yearly', '2027-03-01')).toBe('2028-02-29');
  });

  it('is null when a date is not a real one', () => {
    expect(nextOccurrence('2000-02-30', 'yearly', '2026-10-02')).toBeNull();
    expect(nextOccurrence('2027-02-29', null, '2026-10-02')).toBeNull();
    expect(nextOccurrence('2000-10-02', 'yearly', 'not-a-date')).toBeNull();
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
    expect(daysUntil('2000-10-02', 'yearly', '2026-10-02')).toBe(0);
  });

  it('is 1 across the new year', () => {
    expect(daysUntil('2000-01-01', 'yearly', '2026-12-31')).toBe(1);
    expect(daysUntil('2027-01-01', null, '2026-12-31')).toBe(1);
  });

  it('counts to next year for a yearly date already passed this year', () => {
    expect(daysUntil('2000-10-01', 'yearly', '2026-10-02')).toBe(364);
  });

  it('counts to Feb 28 in a non-leap year and Feb 29 in a leap one', () => {
    expect(daysUntil('2000-02-29', 'yearly', '2027-02-27')).toBe(1);
    expect(daysUntil('2000-02-29', 'yearly', '2028-02-27')).toBe(2);
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

  // `toISOString()` gives the UTC date, a day off for anyone whose local
  // evening or morning straddles UTC midnight.
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
  const birthday: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };

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

  it('never shows a yearly occasion’s stored year, even for a malformed date', () => {
    const malformed: Occasion = { kind: 'birthday', date: '2000-02-30', recurrence: 'yearly' };
    expect(formatOccasionLabel(malformed, '2026-10-02', 'en-US')).toBe('Birthday');
    for (const today of ['2026-10-02', '2026-10-14', '2000-10-14', '2027-01-01']) {
      expect(formatOccasionLabel(birthday, today, 'en-US')).not.toContain('2000');
    }
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

  // `Date.UTC` reads years 0–99 as 1900–1999.
  it('keeps a year below 100 as it is', () => {
    expect(formatCalendarDate('0050-03-04', 'en-US')).toMatch(/^Mar 4, 0*50$/);
    // 1900 years, 460 of them leap.
    expect(daysBetween('0050-01-01', '1950-01-01')).toBe(1900 * 365 + 460);
  });

  it('gives back a value that is not a date unchanged', () => {
    expect(formatCalendarDate('soon', 'en-US')).toBe('soon');
  });
});

describe('occasionSortKey', () => {
  const today = '2026-10-02';
  const soon: Occasion = { kind: 'holiday', date: '2000-12-25', recurrence: 'yearly' };
  const sooner: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
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
  const birthday: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };

  it('compares every field, and treats null and undefined alike as none', () => {
    expect(sameOccasion(birthday, { ...birthday })).toBe(true);
    expect(sameOccasion(birthday, { ...birthday, kind: 'holiday' })).toBe(false);
    expect(sameOccasion(birthday, { ...birthday, date: '2000-10-15' })).toBe(false);
    expect(sameOccasion(birthday, { ...birthday, recurrence: null })).toBe(false);
    expect(sameOccasion(null, undefined)).toBe(true);
    expect(sameOccasion(null, birthday)).toBe(false);
    expect(sameOccasion(birthday, undefined)).toBe(false);
  });
});

describe('the settings form draft', () => {
  const none: OccasionDraft = { kind: 'none', yearly: false, date: '', month: '', day: '' };
  const yearlyBirthday: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
  const wedding: Occasion = { kind: 'wedding', date: '2027-06-12', recurrence: null };

  it('reads no occasion as kind "none", and sends it as null', () => {
    expect(occasionToDraft(null)).toEqual(none);
    expect(occasionToDraft(undefined)).toEqual(none);
    expect(draftToOccasion({ ...none, date: '2027-06-12', month: '06', day: '12' })).toBeNull();
  });

  it('holds a yearly occasion as a month and day, never its stored year', () => {
    const draft = occasionToDraft(yearlyBirthday);
    expect(draft).toEqual({ kind: 'birthday', yearly: true, date: '', month: '10', day: '14' });
    expect(JSON.stringify(draft)).not.toContain('2000');
    expect(draftToOccasion(draft)).toEqual(yearlyBirthday);
  });

  it('holds a one-off as its date, and round-trips it', () => {
    const draft = occasionToDraft(wedding);
    expect(draft).toMatchObject({ kind: 'wedding', yearly: false, date: '2027-06-12' });
    expect(draftToOccasion(draft)).toEqual(wedding);
  });

  it('sends what is missing as an empty date, for the API to refuse, rather than clearing it', () => {
    const holiday: OccasionDraft = { ...none, kind: 'holiday' };
    expect(draftToOccasion(holiday)).toEqual({ kind: 'holiday', date: '', recurrence: null });
    expect(draftToOccasion({ ...holiday, yearly: true, month: '12' })).toEqual({
      kind: 'holiday',
      date: '',
      recurrence: 'yearly',
    });
  });

  it('gives each month its days, Feb 29 included', () => {
    expect(daysInYearlyMonth('02')).toBe(29);
    expect(daysInYearlyMonth('04')).toBe(30);
    expect(daysInYearlyMonth('12')).toBe(31);
    expect(daysInYearlyMonth('')).toBe(31);
  });

  it('keeps the day when a month is picked, or moves it to that month’s last', () => {
    const draft: OccasionDraft = {
      ...none,
      kind: 'birthday',
      yearly: true,
      month: '01',
      day: '31',
    };
    expect(setDraftMonth(draft, '03')).toMatchObject({ month: '03', day: '31' });
    expect(setDraftMonth(draft, '04')).toMatchObject({ month: '04', day: '30' });
    expect(setDraftMonth(draft, '02')).toMatchObject({ month: '02', day: '29' });
    expect(setDraftMonth({ ...draft, day: '' }, '02')).toMatchObject({ month: '02', day: '' });
  });

  it('names what a drafted occasion still needs before it can be saved', () => {
    expect(missingFromDraft(none)).toBeNull();
    const birthday: OccasionDraft = { ...none, kind: 'birthday', yearly: true };
    expect(missingFromDraft(birthday)).toBe('Pick the occasion’s month and day');
    expect(missingFromDraft({ ...birthday, month: '10' })).toBe(
      'Pick the occasion’s month and day'
    );
    expect(missingFromDraft({ ...birthday, month: '10', day: '14' })).toBeNull();
    const wedding: OccasionDraft = { ...none, kind: 'wedding' };
    expect(missingFromDraft(wedding)).toBe('Pick the occasion’s date');
    expect(missingFromDraft({ ...wedding, date: '2027-06-12' })).toBeNull();
  });

  describe('occasionChange', () => {
    const draft = occasionToDraft(yearlyBirthday);

    it('leaves the occasion out when it is what the form was filled from', () => {
      expect(occasionChange(draft, yearlyBirthday)).toBeUndefined();
      expect(occasionChange(none, null)).toBeUndefined();
      expect(occasionChange(none, undefined)).toBeUndefined();
    });

    it('sends the occasion, or null to clear it, when it was changed', () => {
      expect(occasionChange({ ...draft, day: '15' }, yearlyBirthday)).toEqual({
        ...yearlyBirthday,
        date: '2000-10-15',
      });
      expect(occasionChange(none, yearlyBirthday)).toBeNull();
      expect(occasionChange(draft, null)).toEqual(yearlyBirthday);
      expect(occasionChange(occasionToDraft(wedding), yearlyBirthday)).toEqual(wedding);
    });
  });

  describe('setDraftYearly', () => {
    const today = '2026-10-02';

    it("takes a one-off's day and month when it's made yearly", () => {
      const draft = setDraftYearly(occasionToDraft(wedding), true, today);
      expect(draft).toMatchObject({ yearly: true, month: '06', day: '12' });
      expect(draftToOccasion(draft)).toEqual({
        ...wedding,
        date: '2000-06-12',
        recurrence: 'yearly',
      });
    });

    it('puts a yearly day and month on its next date from today when it’s made a one-off', () => {
      const draft = setDraftYearly(occasionToDraft(yearlyBirthday), false, today);
      expect(draft).toMatchObject({ yearly: false, date: '2026-10-14' });
      // Already passed this year: next year's.
      const march = setDraftYearly(
        { ...occasionToDraft(yearlyBirthday), month: '03' },
        false,
        today
      );
      expect(march.date).toBe('2027-03-14');
    });

    // regression: the one-off took Feb 29's next occurrence, Feb 28 in a year
    // without one, and making it yearly again read Feb 28 back from it.
    it('regression: keeps Feb 29 through a switch to a one-off and back, on the next real Feb 29', () => {
      const leapDay = setDraftYearly(
        { ...occasionToDraft(yearlyBirthday), month: '02', day: '29' },
        false,
        today
      );
      expect(leapDay.date).toBe('2028-02-29');
      const back = setDraftYearly(leapDay, true, today);
      expect(back).toMatchObject({ yearly: true, month: '02', day: '29' });
      expect(draftToOccasion(back)?.date).toBe('2000-02-29');
    });

    it('keeps the one-off date it had when the day and month are unchanged', () => {
      const there = setDraftYearly(occasionToDraft(wedding), true, today);
      expect(setDraftYearly(there, false, today).date).toBe('2027-06-12');
      // A changed day picks the next date for it instead.
      expect(setDraftYearly({ ...there, day: '20' }, false, today).date).toBe('2027-06-20');
    });

    it('leaves the other side as it was when there is nothing to carry over', () => {
      const blank: OccasionDraft = { ...none, kind: 'birthday' };
      expect(setDraftYearly(blank, true, today)).toEqual({ ...blank, yearly: true });
      expect(setDraftYearly({ ...blank, yearly: true, month: '05' }, false, today)).toEqual({
        ...blank,
        month: '05',
      });
      expect(setDraftYearly(blank, false, today)).toBe(blank);
    });
  });
});
