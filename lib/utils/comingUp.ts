import { daysUntil, nextOccurrence, occasionSortKey, type Occasion } from '@/lib/utils/occasion';

/** How far ahead the dashboard's Coming up looks: occasions within the next 30 days. */
export const COMING_UP_DAYS = 30;

/** What Coming up reads of a list. */
export interface ComingUpList {
  name: string;
  occasion?: Occasion | null;
  archived?: boolean;
}

/** A list in Coming up: its occasion's next day, and how far off that is. */
export interface ComingUpEntry<T> {
  list: T;
  /** Yours (Share) or shared with you (Find a gift). */
  own: boolean;
  /** Days until its occasion: 0 today, 1 tomorrow. */
  days: number;
  /** The day it next falls on, `YYYY-MM-DD`: never a yearly occasion's stored one. */
  date: string;
}

/**
 * The dashboard's Coming up: every list, your own (`own`) and the ones shared
 * with you (`shared`), whose occasion next falls within `COMING_UP_DAYS` of
 * `today` (the viewer's local date, `useLocalToday`), today included: the
 * nearest first (`occasionSortKey`), then by name. A list with no occasion, a
 * one-off that has passed, or one further off is left out, and so is an
 * archived list, whoever's it is.
 *
 * Both are lists the viewer can open, as `GET /api/wishlists` gives them (your
 * own, and the ones you're a member of), and nothing is said of reservations:
 * this only orders them.
 */
export function comingUp<T extends ComingUpList>(
  own: readonly T[],
  shared: readonly T[],
  today: string
): ComingUpEntry<T>[] {
  const entries: ComingUpEntry<T>[] = [];
  const add = (list: T, isOwn: boolean) => {
    if (list.archived || !list.occasion) return;
    const days = occasionSortKey(list.occasion, today);
    if (days > COMING_UP_DAYS) return;
    const date = nextOccurrence(list.occasion.date, list.occasion.recurrence, today);
    if (date === null) return;
    entries.push({ list, own: isOwn, days, date });
  };
  own.forEach((list) => add(list, true));
  shared.forEach((list) => add(list, false));
  return entries.sort((a, b) => a.days - b.days || a.list.name.localeCompare(b.list.name));
}

/**
 * A friend's birthday as `GET /api/users/me/birthdays` answers it (WIS-343):
 * their handle, photo and stored birthday (`YYYY-MM-DD` on
 * `YEARLY_PLACEHOLDER_YEAR`), and nothing else: no email, no lists.
 */
export interface FriendBirthday {
  id: string;
  username: string;
  image?: string | null;
  birthday: string;
}

/** A friend's birthday in Coming up: its next day, and how far off that is. */
export interface BirthdayEntry<P> {
  person: P;
  /** Days until it: 0 today, 1 tomorrow. */
  days: number;
  /** The day it next falls on, `YYYY-MM-DD`: never the stored placeholder year. */
  date: string;
}

/**
 * The friends' birthdays for Coming up: each one whose next occurrence
 * (`nextOccurrence`, so a Feb 29 birthday falls on Feb 28 in a year without
 * one) is within `COMING_UP_DAYS` of `today`, the viewer's local date. The
 * viewer's own (`viewerId`) never is one, whatever the answer carries.
 */
export function birthdaysComingUp<P extends FriendBirthday>(
  people: readonly P[],
  today: string,
  viewerId?: string | null
): BirthdayEntry<P>[] {
  const entries: BirthdayEntry<P>[] = [];
  for (const person of people) {
    if (viewerId && person.id === viewerId) continue;
    const days = daysUntil(person.birthday, 'yearly', today);
    if (days === null || days > COMING_UP_DAYS) continue;
    const date = nextOccurrence(person.birthday, 'yearly', today);
    if (date === null) continue;
    entries.push({ person, days, date });
  }
  return entries;
}

/** One card in Coming up: a list (`comingUp`), or a friend's birthday (`birthdaysComingUp`). */
export type ComingUpCard<T, P> =
  ({ kind: 'list' } & ComingUpEntry<T>) | ({ kind: 'birthday' } & BirthdayEntry<P>);

/**
 * Coming up's cards: the lists and the friends' birthdays side by side, the
 * nearest first, then by name (a list's name, a friend's username). Each stays
 * its own card, even a friend's birthday and her Birthday list on the same
 * day: a birthday is about the person and never stands for, or hints at, any
 * list of theirs.
 */
export function mergeComingUp<T extends ComingUpList, P extends FriendBirthday>(
  lists: readonly ComingUpEntry<T>[],
  birthdays: readonly BirthdayEntry<P>[]
): ComingUpCard<T, P>[] {
  const name = (card: ComingUpCard<T, P>) =>
    card.kind === 'list' ? card.list.name : card.person.username;
  const cards: ComingUpCard<T, P>[] = [
    ...lists.map((entry) => ({ kind: 'list' as const, ...entry })),
    ...birthdays.map((entry) => ({ kind: 'birthday' as const, ...entry })),
  ];
  return cards.sort((a, b) => a.days - b.days || name(a).localeCompare(name(b)));
}
