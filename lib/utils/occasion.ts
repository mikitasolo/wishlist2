/**
 * A wishlist's occasion: at most one per list (`Wishlist.occasion`), opt-in,
 * and organizational only. It never decides who can see the list.
 *
 * Every date here is a plain calendar date, `YYYY-MM-DD`, never a timestamp,
 * and so is "today": the *viewer's* local date (`localDateString`), which is
 * why a countdown is only ever worked out in the browser. The arithmetic runs
 * on whole days in UTC, where every day is 24 hours long, so no time zone or
 * daylight-saving change can shift a date by one.
 *
 * A yearly occasion's next occurrence is computed for display. Nothing is ever
 * written back: the stored date stays the one the owner picked.
 */

export const OCCASION_KINDS = ['birthday', 'holiday', 'wedding', 'other'] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];

/** `'yearly'` repeats on the same day every year; `null` happens once. */
export type OccasionRecurrence = 'yearly' | null;

export interface Occasion {
  kind: OccasionKind;
  /** `YYYY-MM-DD`. For a yearly occasion, the first time it happens. */
  date: string;
  recurrence: OccasionRecurrence;
}

/** Short names, sized to sit next to a list's name. `other` reads as "Occasion". */
export const OCCASION_KIND_LABELS: Record<OccasionKind, string> = {
  birthday: 'Birthday',
  holiday: 'Holiday',
  wedding: 'Wedding',
  other: 'Occasion',
};

/** The years an occasion's date may fall in (the settings date input's range too). */
export const MIN_OCCASION_YEAR = 1900;
export const MAX_OCCASION_YEAR = 2999;

/**
 * What `occasionSortKey` gives a list with nothing coming up (no occasion, or a
 * one-off that has passed): a finite number, so `a - b` still works on it.
 */
export const NO_UPCOMING_OCCASION = Number.MAX_SAFE_INTEGER;

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parse a `YYYY-MM-DD` string, or `null` unless it names a real day. */
function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function toCalendarString({ year, month, day }: CalendarDate): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Whole days since the epoch, counted in UTC (no time zone, no DST). */
function dayNumber({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/**
 * Whether `value` is a real calendar date in `YYYY-MM-DD` form, between
 * `MIN_OCCASION_YEAR` and `MAX_OCCASION_YEAR`: `2028-02-29` is one,
 * `2027-02-29` and `2026-02-30` aren't.
 */
export function isCalendarDate(value: string): boolean {
  const parsed = parseCalendarDate(value);
  return !!parsed && parsed.year >= MIN_OCCASION_YEAR && parsed.year <= MAX_OCCASION_YEAR;
}

/**
 * The local calendar date of `now` (default: this moment), as `YYYY-MM-DD`.
 * Read from the local date fields, never `toISOString()`, which is the UTC date
 * and so a day off for anyone whose evening or morning straddles UTC midnight.
 */
export function localDateString(now: Date = new Date()): string {
  return toCalendarString({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

/**
 * Days from `from` to `to` (both `YYYY-MM-DD`): positive when `to` is later, 0
 * on the same day, `null` if either isn't a real date.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  if (!a || !b) return null;
  return dayNumber(b) - dayNumber(a);
}

/**
 * The next time an occasion happens, on or after `today` (all `YYYY-MM-DD`),
 * or `null` when it won't happen again: a one-off whose date has passed.
 *
 * A yearly occasion starts on its own date, then falls on the same month and
 * day every year after, rolling into next year once this year's has passed. A
 * Feb 29 one falls on Feb 28 in a year that has no Feb 29. `today` is the
 * viewer's local date (`localDateString`). Anything that isn't a real date
 * gives `null`.
 */
export function nextOccurrence(
  date: string,
  recurrence: OccasionRecurrence,
  today: string
): string | null {
  const start = parseCalendarDate(date);
  const now = parseCalendarDate(today);
  if (!start || !now) return null;
  if (dayNumber(start) >= dayNumber(now)) return date;
  if (recurrence !== 'yearly') return null;

  const inYear = (year: number): CalendarDate => ({
    year,
    month: start.month,
    day: Math.min(start.day, daysInMonth(year, start.month)),
  });
  const thisYear = inYear(now.year);
  return toCalendarString(dayNumber(thisYear) >= dayNumber(now) ? thisYear : inYear(now.year + 1));
}

/**
 * Days from `today` until the occasion's next occurrence (`nextOccurrence`):
 * 0 when it's today, 1 tomorrow, and `null` when it won't happen again.
 */
export function daysUntil(
  date: string,
  recurrence: OccasionRecurrence,
  today: string
): number | null {
  const next = nextOccurrence(date, recurrence, today);
  return next === null ? null : daysBetween(today, next);
}

/**
 * A key for sorting by nearest occasion: the days until it, or
 * `NO_UPCOMING_OCCASION` when there's nothing coming up (no occasion, or a
 * passed one-off), so `(a, b) => occasionSortKey(a, today) - occasionSortKey(b, today)`
 * puts the soonest first and those last.
 */
export function occasionSortKey(occasion: Occasion | null | undefined, today: string): number {
  if (!occasion) return NO_UPCOMING_OCCASION;
  return daysUntil(occasion.date, occasion.recurrence, today) ?? NO_UPCOMING_OCCASION;
}

/** The short name for an occasion's kind ("Birthday"), "Occasion" for an unknown one. */
export function occasionKindLabel(kind: string): string {
  return OCCASION_KIND_LABELS[kind as OccasionKind] ?? OCCASION_KIND_LABELS.other;
}

/**
 * A calendar date for people, e.g. "Mar 4, 2027" (in `locale`, default: the
 * viewer's). The date is formatted in UTC, so it's never shifted by a day. An
 * unparseable value comes back as it is.
 */
export function formatCalendarDate(date: string, locale?: string): string {
  const parsed = parseCalendarDate(date);
  if (!parsed) return date;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

/**
 * The label shown next to a list's name: "Birthday · today", "Birthday ·
 * tomorrow", "Birthday · in 12 days", or, for a one-off that has passed, just
 * the kind and its date ("Wedding · Jun 12, 2026"), with no countdown. `today`
 * is the viewer's local date, so call this in the browser (see `useLocalToday`).
 */
export function formatOccasionLabel(occasion: Occasion, today: string, locale?: string): string {
  const kind = occasionKindLabel(occasion.kind);
  const days = daysUntil(occasion.date, occasion.recurrence, today);
  if (days === null) return `${kind} · ${formatCalendarDate(occasion.date, locale)}`;
  if (days === 0) return `${kind} · today`;
  if (days === 1) return `${kind} · tomorrow`;
  return `${kind} · in ${days} days`;
}

/** Whether two occasions are the same, `null` / `undefined` (none) included. */
export function sameOccasion(
  a: Occasion | null | undefined,
  b: Occasion | null | undefined
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.kind === b.kind && a.date === b.date && (a.recurrence ?? null) === (b.recurrence ?? null)
  );
}

/**
 * The settings form's occasion, which may be half filled in (a kind picked, no
 * date yet). `kind: 'none'` means the list has no occasion.
 */
export interface OccasionDraft {
  kind: OccasionKind | 'none';
  date: string;
  yearly: boolean;
}

/** The settings form's starting point for a list's occasion (or its lack of one). */
export function occasionToDraft(occasion: Occasion | null | undefined): OccasionDraft {
  if (!occasion) return { kind: 'none', date: '', yearly: false };
  return { kind: occasion.kind, date: occasion.date, yearly: occasion.recurrence === 'yearly' };
}

/**
 * What the settings form sends: `null` (no occasion) for `kind: 'none'`, else
 * the occasion as drafted. A missing date is sent as it is, for the API to
 * refuse, rather than quietly clearing the occasion.
 */
export function draftToOccasion(draft: OccasionDraft): Occasion | null {
  if (draft.kind === 'none') return null;
  return { kind: draft.kind, date: draft.date, recurrence: draft.yearly ? 'yearly' : null };
}
