import { describe, it, expect } from 'vitest';
import { safeCallbackPath, SIGN_IN_PATH } from '@/lib/utils/callbackUrl';
import { signInRetryPath } from '@/lib/utils/signInForm';
import {
  BIRTHDAY_NUDGE_EMAIL_PATH,
  BIRTHDAY_NUDGE_HOME_PATH,
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
  const today = '2026-10-06';
  const yearly = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: 'yearly' });
  const oneOff = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: null });
  const ids = (lists: Parameters<typeof olderBirthdayLists>[0]) =>
    olderBirthdayLists(lists, today).map((w) => w._id);

  it('keeps only Birthday lists, as id and name, newest created first', () => {
    expect(
      olderBirthdayLists(
        [
          { _id: 'old', name: '2023', occasion: oneOff('2023-03-14'), createdAt: '2023-01-01' },
          {
            _id: 'trip',
            name: 'Trip',
            occasion: { kind: 'other', date: '2024-03-14', recurrence: null },
          },
          { _id: 'none', name: 'None', occasion: null },
          { _id: 'new', name: '2025', occasion: oneOff('2025-03-14'), createdAt: '2025-01-01' },
        ],
        today
      )
    ).toEqual([
      { _id: 'new', name: '2025' },
      { _id: 'old', name: '2023' },
    ]);
  });
  // regression: "last year's list" could be this year's, made after the nudge email went out.
  it('regression: leaves out this birthday’s own list: a one-off in the window, or a yearly one made lately', () => {
    expect(
      ids([
        { _id: 'mine', name: 'This year', occasion: oneOff('2026-10-20') },
        { _id: 'just', name: 'Just past', occasion: oneOff('2026-09-20') },
        { _id: 'week', name: 'Yearly', occasion: yearly('2000-10-20'), createdAt: '2026-09-29' },
        {
          _id: 'arch',
          name: 'Archived',
          archived: true,
          occasion: yearly('2000-10-20'),
          createdAt: '2026-09-29',
        },
        { _id: 'none', name: 'Unknown', occasion: yearly('2000-10-20') },
        { _id: 'far', name: 'Far off', occasion: oneOff('2026-03-14') },
      ])
    ).toEqual(['far']);
  });
  // regression: a yearly list keeps its day every year, so last year's is always in the window.
  it('regression: offers a yearly list made a year ago, archived or not, though its date is in the window', () => {
    expect(
      ids([
        { _id: 'live', name: 'A', occasion: yearly('2000-10-20'), createdAt: '2025-09-01' },
        {
          _id: 'arch',
          name: 'B',
          archived: true,
          occasion: yearly('2000-10-20'),
          createdAt: '2024-09-01',
        },
      ])
    ).toEqual(['live', 'arch']);
  });
  it('is empty with no lists or no date today', () => {
    expect(ids(null)).toEqual([]);
    expect(
      olderBirthdayLists([{ _id: 'a', name: 'A', occasion: oneOff('2020-01-01') }], null)
    ).toEqual([]);
  });
});

describe('BIRTHDAY_NUDGE_EMAIL_PATH (WIS-347)', () => {
  const origin = 'http://localhost:3000';
  const callback = () => new URL(BIRTHDAY_NUDGE_EMAIL_PATH, origin).searchParams.get('callbackUrl');

  // regression: the email linked to `/?newList=birthday` itself; signed out,
  // Home shows the landing, and New list on Birthday was lost through sign-in.
  it('regression: goes through sign-in, continuing to New list on a Birthday list', () => {
    expect(new URL(BIRTHDAY_NUDGE_EMAIL_PATH, origin).pathname).toBe(SIGN_IN_PATH);
    expect(callback()).toBe(BIRTHDAY_NUDGE_HOME_PATH);
    expect(BIRTHDAY_NUDGE_HOME_PATH).toBe('/?newList=birthday');
  });

  it('continues only to that path on this site, as the sign-in and error pages read it', () => {
    expect(safeCallbackPath(callback(), origin, '/auth')).toBe('/?newList=birthday');
    expect(signInRetryPath(callback(), origin)).toBe(BIRTHDAY_NUDGE_EMAIL_PATH);
  });
});
