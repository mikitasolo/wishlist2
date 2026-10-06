import { addDays, daysBetween, nextOccurrence, type Occasion } from '@/lib/utils/occasion';

/**
 * The nudge to make a list before your own birthday (WIS-344): a row in
 * Needs you, and one email a year (`lib/utils/birthdayNudgeEmails.ts`).
 *
 * - **When**: from `BIRTHDAY_NUDGE_LEAD_DAYS` (21) before your profile
 *   birthday (`User.birthday`) until the day itself, counted from the viewer's
 *   local date in the browser (`useLocalToday`) and from the UTC date in the
 *   cron, as occasion reminders are.
 * - **Not while a Birthday list is coming**: any unarchived list you own, alone
 *   or with others, whose occasion kind is `birthday` and whose date falls in
 *   the lead window or up to `BIRTHDAY_LIST_GRACE_DAYS` after the birthday
 *   (`hasBirthdayListComing`). Lists keep their own dates (a party a few days
 *   off counts), and the profile birthday never fills one in.
 *
 * Pure: the callers read the birthday and the lists.
 */

/** How many days before your birthday the nudge starts (operator, 2026-10-06). */
export const BIRTHDAY_NUDGE_LEAD_DAYS = 21;

/**
 * How many days after the birthday a Birthday list's date still counts as
 * this birthday's: a party the weekend after silences the nudge too.
 */
export const BIRTHDAY_LIST_GRACE_DAYS = 7;

/** The birthday the nudge is about: its next occurrence, and the days until it. */
export interface BirthdayNudgeDue {
  /** The next occurrence (`YYYY-MM-DD`, a real year), on or after `today`. */
  occurrence: string;
  /** Days from `today` until then: 0 on the day itself. */
  days: number;
}

/**
 * The birthday's next occurrence when it's within the nudge's window from
 * `today` (0 to `BIRTHDAY_NUDGE_LEAD_DAYS` days away), else `null`: none set,
 * an unreadable one, or further off. A Feb 29 birthday falls on Feb 28 in a
 * year without one (`nextOccurrence`).
 */
export function birthdayNudgeDue(
  birthday: string | null | undefined,
  today: string | null | undefined
): BirthdayNudgeDue | null {
  if (!birthday || !today) return null;
  const occurrence = nextOccurrence(birthday, 'yearly', today);
  if (!occurrence) return null;
  const days = daysBetween(today, occurrence);
  if (days === null || days < 0 || days > BIRTHDAY_NUDGE_LEAD_DAYS) return null;
  return { occurrence, days };
}

/** A list as the "Birthday list coming" rule reads it. */
export interface BirthdayRuleList {
  archived?: boolean | null;
  occasion?: Occasion | null;
}

/**
 * Whether one of `lists` (the person's own, co-owned included) is a Birthday
 * list for the birthday on `occurrence`: unarchived, occasion kind `birthday`,
 * and its date (a yearly one's occurrence that year) between the start of the
 * lead window (`BIRTHDAY_NUDGE_LEAD_DAYS` before) and `BIRTHDAY_LIST_GRACE_DAYS`
 * after. Any one is enough, however many there are.
 */
export function hasBirthdayListComing(
  lists: readonly BirthdayRuleList[],
  occurrence: string
): boolean {
  const from = addDays(occurrence, -BIRTHDAY_NUDGE_LEAD_DAYS);
  const to = addDays(occurrence, BIRTHDAY_LIST_GRACE_DAYS);
  if (!from || !to) return false;
  return lists.some((list) => {
    const occasion = list.occasion;
    if (list.archived || !occasion || occasion.kind !== 'birthday') return false;
    // The list's first date on or after the window's start: a one-off's own
    // date (null once it's before the window), a yearly one's next occurrence.
    const date = nextOccurrence(occasion.date, occasion.recurrence ?? null, from);
    const until = date === null ? null : daysBetween(date, to);
    return until !== null && until >= 0;
  });
}

/**
 * Whether to nudge: the birthday is in its window from `today` and no Birthday
 * list is coming for it. The occurrence and countdown when so, else `null`.
 */
export function birthdayNudge(
  birthday: string | null | undefined,
  lists: readonly BirthdayRuleList[],
  today: string | null | undefined
): BirthdayNudgeDue | null {
  const due = birthdayNudgeDue(birthday, today);
  if (!due || hasBirthdayListComing(lists, due.occurrence)) return null;
  return due;
}

/** "in 3 weeks", "in a week", "in 10 days", "tomorrow", "today". */
export function birthdayCountdown(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === 7) return 'in a week';
  if (days % 7 === 0) return `in ${days / 7} weeks`;
  return `in ${days} days`;
}

/** The nudge's heading: "Your birthday is in 3 weeks". */
export function birthdayNudgeTitle(days: number): string {
  return `Your birthday is ${birthdayCountdown(days)}`;
}

/** The nudge's line under it, in Needs you and the email. */
export const BIRTHDAY_NUDGE_DETAIL = 'Make a list so friends know what to get you.';

/** Home's query that opens New list on a Birthday list (`?newList=birthday`). */
export const NEW_LIST_PARAM = 'newList';
/** Where the email's button goes: Home, with New list open on a Birthday list. */
export const BIRTHDAY_NUDGE_HOME_PATH = `/?${NEW_LIST_PARAM}=birthday`;

/**
 * The older Birthday lists a new one can start from (WIS-348): the lists you
 * own (alone or co-owned, archived or not) whose occasion kind is `birthday`,
 * newest created first (`createdAt`, the given order where it's missing).
 * Only `{ _id, name }` leaves it: the owner's own lists.
 *
 * Not this birthday's own: the profile birthday isn't known here (the email's
 * link opens New list whenever), so the nudge's window (`hasBirthdayListComing`)
 * is taken at its widest for any birthday the nudge could be showing for, from
 * `BIRTHDAY_NUDGE_LEAD_DAYS` before `today` to the lead plus the grace days
 * after it. A list whose date falls in it is left out when it's unarchived (it
 * is the one the nudge means) or a one-off (made for this year's); an archived
 * yearly list is last year's whatever its date. Nothing without `today`.
 */
export function olderBirthdayLists<
  T extends {
    _id: unknown;
    name: string;
    createdAt?: unknown;
    archived?: boolean | null;
    occasion?: Occasion | null;
  },
>(ownLists: readonly T[] | null | undefined, today: string | null | undefined) {
  const from = today ? addDays(today, -BIRTHDAY_NUDGE_LEAD_DAYS) : null;
  const to = today ? addDays(today, BIRTHDAY_NUDGE_LEAD_DAYS + BIRTHDAY_LIST_GRACE_DAYS) : null;
  if (!from || !to) return [];
  const time = (w: T) => (w.createdAt ? new Date(w.createdAt as string).getTime() || 0 : 0);
  return (ownLists ?? [])
    .filter((w) => {
      const o = w.occasion;
      if (o?.kind !== 'birthday') return false;
      const date = nextOccurrence(o.date, o.recurrence ?? null, from);
      const inWindow = date !== null && (daysBetween(date, to) ?? -1) >= 0;
      return !(inWindow && (!w.archived || o.recurrence !== 'yearly'));
    })
    .sort((a, b) => time(b) - time(a))
    .map((w) => ({ _id: String(w._id), name: w.name }));
}
