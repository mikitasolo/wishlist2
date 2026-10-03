import { nextOccurrence, occasionSortKey, type Occasion } from '@/lib/utils/occasion';

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
