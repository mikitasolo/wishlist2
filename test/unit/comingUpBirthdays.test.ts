import { describe, it, expect } from 'vitest';
import {
  birthdaysComingUp,
  comingUp,
  COMING_UP_DAYS,
  mergeComingUp,
  type FriendBirthday,
} from '@/lib/utils/comingUp';
import type { Occasion } from '@/lib/utils/occasion';

// WIS-343: friends' birthdays in the dashboard's Coming up, beside the lists.

const TODAY = '2026-10-02';
const friend = (username: string, birthday: string): FriendBirthday => ({
  id: `${username}-id`,
  username,
  image: null,
  birthday,
});
const yearly = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: 'yearly' });
const list = (name: string, occasion: Occasion | null) => ({ name, occasion });

describe('birthdaysComingUp', () => {
  it('keeps the birthdays in the next 30 days, today included, with their next day', () => {
    const entries = birthdaysComingUp(
      [
        friend('today', '2000-10-02'),
        friend('edge', '2000-11-01'), // 30 days
        friend('later', '2000-11-02'), // 31 days
        friend('passed', '2000-10-01'), // next year: 364 days
      ],
      TODAY
    );
    expect(entries.map((e) => [e.person.username, e.days, e.date])).toEqual([
      ['today', 0, '2026-10-02'],
      ['edge', COMING_UP_DAYS, '2026-11-01'],
    ]);
  });

  it('rolls into next year, and never shows the stored placeholder year', () => {
    const [entry] = birthdaysComingUp([friend('anna', '2000-01-05')], '2026-12-20');
    expect(entry).toMatchObject({ days: 16, date: '2027-01-05' });
  });

  it('puts a Feb 29 birthday on Feb 28 in a year without one, as nextOccurrence does', () => {
    const [entry] = birthdaysComingUp([friend('leap', '2000-02-29')], '2027-02-20');
    expect(entry).toMatchObject({ days: 8, date: '2027-02-28' });
    const [leapYear] = birthdaysComingUp([friend('leap', '2000-02-29')], '2028-02-20');
    expect(leapYear).toMatchObject({ days: 9, date: '2028-02-29' });
  });

  it('never makes an entry of your own birthday, or of a date that isn’t one', () => {
    const entries = birthdaysComingUp(
      [friend('me', '2000-10-03'), friend('broken', 'not-a-date'), friend('anna', '2000-10-04')],
      TODAY,
      'me-id'
    );
    expect(entries.map((e) => e.person.username)).toEqual(['anna']);
  });
});

describe('mergeComingUp', () => {
  it('sorts lists and birthdays together by days, then by name, each its own card', () => {
    const lists = comingUp(
      [list('Zoo trip', yearly('2000-10-05')), list('Anna’s 30th', yearly('2000-10-04'))],
      [],
      TODAY
    );
    const birthdays = birthdaysComingUp(
      [friend('anna', '2000-10-04'), friend('bob', '2000-10-03'), friend('zed', '2000-10-05')],
      TODAY
    );
    const cards = mergeComingUp(lists, birthdays);
    expect(
      cards.map((c) =>
        c.kind === 'list' ? `list:${c.list.name}` : `birthday:${c.person.username}`
      )
    ).toEqual([
      'birthday:bob',
      // Same day: her birthday and her Birthday list both stay, by name.
      'birthday:anna',
      'list:Anna’s 30th',
      'birthday:zed',
      'list:Zoo trip',
    ]);
  });

  it('is just the lists when there are no birthdays, and just the birthdays when no lists', () => {
    const lists = comingUp([list('Trip', yearly('2000-10-03'))], [], TODAY);
    expect(mergeComingUp(lists, []).map((c) => c.kind)).toEqual(['list']);
    const birthdays = birthdaysComingUp([friend('anna', '2000-10-03')], TODAY);
    expect(mergeComingUp([], birthdays).map((c) => c.kind)).toEqual(['birthday']);
  });
});
