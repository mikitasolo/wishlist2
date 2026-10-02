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
 * A yearly occasion has no year of its own: only its day and month matter, so
 * it's stored with `YEARLY_PLACEHOLDER_YEAR` in place of whatever year it was
 * sent with (`normalizeOccasionDate`, applied by `occasionSchema`). A real year,
 * such as a birth year, never reaches the database or anyone who can see the
 * list, and nothing here ever shows the placeholder. A one-off keeps its year.
 * The next occurrence of a yearly one is computed for display; nothing is ever
 * written back.
 */

export const OCCASION_KINDS = ['birthday', 'holiday', 'wedding', 'other'] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];

/** `'yearly'` repeats on the same day every year; `null` happens once. */
export type OccasionRecurrence = 'yearly' | null;

export interface Occasion {
  kind: OccasionKind;
  /**
   * `YYYY-MM-DD`. A one-off's real date. A yearly occasion's year is always
   * `YEARLY_PLACEHOLDER_YEAR` and means nothing: only the month and day do.
   */
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

/**
 * The year every yearly occasion is stored with. A leap year, so Feb 29 is a
 * valid yearly date. Never shown to anyone.
 */
export const YEARLY_PLACEHOLDER_YEAR = 2000;

/** The years a one-off occasion's date may fall in (the settings date input's range too). */
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

/**
 * Milliseconds since the epoch at UTC midnight of a date. Through
 * `setUTCFullYear`, as `Date.UTC` would read years 0–99 as 1900–1999.
 */
function utcMidnight({ year, month, day }: CalendarDate): number {
  return new Date(0).setUTCFullYear(year, month - 1, day);
}

/** Whole days since the epoch, counted in UTC (no time zone, no DST). */
function dayNumber(date: CalendarDate): number {
  return utcMidnight(date) / DAY_MS;
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
 * An occasion's date as it's stored, or `null` if it isn't a real one. A
 * one-off's date must be a real calendar date and is kept as it is. A yearly
 * one's year is replaced with `YEARLY_PLACEHOLDER_YEAR`, whatever it was, and
 * its month and day are checked against that leap year: `1990-02-29` becomes
 * `2000-02-29`, and `1990-02-30` is refused.
 */
export function normalizeOccasionDate(date: string, recurrence: OccasionRecurrence): string | null {
  if (recurrence !== 'yearly') return isCalendarDate(date) ? date : null;
  const match = CALENDAR_DATE.exec(date);
  if (!match) return null;
  const yearly = `${YEARLY_PLACEHOLDER_YEAR}-${match[2]}-${match[3]}`;
  return parseCalendarDate(yearly) ? yearly : null;
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
 * A yearly occasion falls on its month and day every year (its year is ignored),
 * rolling into next year once this year's has passed. A Feb 29 one falls on
 * Feb 28 in a year that has no Feb 29. `today` is the viewer's local date
 * (`localDateString`). Anything that isn't a real date gives `null`.
 */
export function nextOccurrence(
  date: string,
  recurrence: OccasionRecurrence,
  today: string
): string | null {
  const now = parseCalendarDate(today);
  if (!now) return null;
  if (recurrence !== 'yearly') {
    const once = parseCalendarDate(date);
    return once && dayNumber(once) >= dayNumber(now) ? date : null;
  }

  const yearly = parseCalendarDate(normalizeOccasionDate(date, 'yearly') ?? '');
  if (!yearly) return null;
  const inYear = (year: number): CalendarDate => ({
    year,
    month: yearly.month,
    day: Math.min(yearly.day, daysInMonth(year, yearly.month)),
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
 * unparseable value comes back as it is. Give it a real date (a one-off's, or
 * a next occurrence), never a yearly occasion's stored one.
 */
export function formatCalendarDate(date: string, locale?: string): string {
  const parsed = parseCalendarDate(date);
  if (!parsed) return date;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utcMidnight(parsed));
}

/**
 * The label shown next to a list's name: "Birthday · today", "Birthday ·
 * tomorrow", "Birthday · in 12 days", or, for a one-off that has passed, just
 * the kind and its date ("Wedding · Jun 12, 2026"), with no countdown. A
 * yearly occasion always has a countdown, so its stored year is never shown.
 * `today` is the viewer's local date, so call this in the browser (see
 * `useLocalToday`).
 */
export function formatOccasionLabel(occasion: Occasion, today: string, locale?: string): string {
  const kind = occasionKindLabel(occasion.kind);
  const days = daysUntil(occasion.date, occasion.recurrence, today);
  if (days === null) {
    // Only a malformed yearly date gets here: show the kind, never its year.
    if (occasion.recurrence === 'yearly') return kind;
    return `${kind} · ${formatCalendarDate(occasion.date, locale)}`;
  }
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

/** How many days a month (`'01'`–`'12'`) can have in a yearly occasion: Feb has 29. */
export function daysInYearlyMonth(month: string): number {
  const m = Number(month);
  return m >= 1 && m <= 12 ? daysInMonth(YEARLY_PLACEHOLDER_YEAR, m) : 31;
}

/**
 * The settings form's occasion, which may be half filled in (a kind picked, no
 * date yet). `kind: 'none'` means the list has no occasion. A yearly one is
 * picked as a month and a day (`'01'`–`'12'`, `'01'`–`'31'`, `''` until
 * chosen), a one-off as a full `date`, and switching between the two carries
 * the day and month across (`setDraftYearly`).
 */
export interface OccasionDraft {
  kind: OccasionKind | 'none';
  yearly: boolean;
  /** The one-off's date, `YYYY-MM-DD`, or `''`. */
  date: string;
  /** The yearly one's month and day, or `''`. */
  month: string;
  day: string;
}

const monthDayOf = (date: string) => {
  const match = CALENDAR_DATE.exec(date);
  return match ? { month: match[2], day: match[3] } : null;
};

/** The settings form's starting point for a list's occasion (or its lack of one). */
export function occasionToDraft(occasion: Occasion | null | undefined): OccasionDraft {
  if (!occasion) return { kind: 'none', yearly: false, date: '', month: '', day: '' };
  const yearly = occasion.recurrence === 'yearly';
  return {
    kind: occasion.kind,
    yearly,
    // A yearly occasion's stored year is the placeholder: the form never holds it.
    date: yearly ? '' : occasion.date,
    ...(monthDayOf(occasion.date) ?? { month: '', day: '' }),
  };
}

/** Pick a yearly occasion's month, keeping its day if that month has it, else its last day. */
export function setDraftMonth(draft: OccasionDraft, month: string): OccasionDraft {
  const last = daysInYearlyMonth(month);
  const day = draft.day && Number(draft.day) > last ? pad(last) : draft.day;
  return { ...draft, month, day };
}

/**
 * The first date on or after `today` that is exactly this month and day: a
 * Feb 29 waits for the next leap year rather than falling on Feb 28.
 */
function nextDateOn(month: string, day: string, today: string): string | null {
  const now = parseCalendarDate(today);
  if (!now) return null;
  // Leap years are at most 8 apart (around 2100), so this always finds one.
  for (let year = now.year; year <= now.year + 8; year++) {
    const candidate = parseCalendarDate(`${pad(year, 4)}-${month}-${day}`);
    if (candidate && dayNumber(candidate) >= dayNumber(now)) return toCalendarString(candidate);
  }
  return null;
}

/**
 * Turn "Repeats every year" on or off, keeping the day and month. Off, the
 * one-off's date is the next time that exact day comes round from `today` (the
 * viewer's local date; a Feb 29 waits for a leap year), unless the date
 * already there falls on it. On, the month and day come from the one-off's
 * date. So switching there and back gives the same day and month.
 */
export function setDraftYearly(
  draft: OccasionDraft,
  yearly: boolean,
  today: string
): OccasionDraft {
  if (yearly === draft.yearly) return draft;
  if (yearly) return { ...draft, yearly, ...(monthDayOf(draft.date) ?? {}) };

  if (!draft.month || !draft.day) return { ...draft, yearly };
  const current = monthDayOf(draft.date);
  if (current?.month === draft.month && current.day === draft.day) return { ...draft, yearly };
  return { ...draft, yearly, date: nextDateOn(draft.month, draft.day, today) ?? draft.date };
}

/**
 * The occasion the settings form sends: the drafted one, or `undefined` (left
 * out of the edit) when it's the same as `baseline`, the occasion the form was
 * filled from. So saving the other settings can't undo an occasion a co-owner
 * set since.
 */
export function occasionChange(
  draft: OccasionDraft,
  baseline: Occasion | null | undefined
): Occasion | null | undefined {
  const occasion = draftToOccasion(draft);
  return sameOccasion(occasion, baseline) ? undefined : occasion;
}

/**
 * What a drafted occasion still needs before it can be saved, as a message for
 * the owner, or `null` when nothing's missing (or there's no occasion).
 */
export function missingFromDraft(draft: OccasionDraft): string | null {
  if (draft.kind === 'none') return null;
  if (draft.yearly) return draft.month && draft.day ? null : 'Pick the occasion’s month and day';
  return draft.date ? null : 'Pick the occasion’s date';
}

/**
 * What the settings form sends: `null` (no occasion) for `kind: 'none'`, else
 * the occasion as drafted, a yearly one on `YEARLY_PLACEHOLDER_YEAR`. A
 * missing date (or month or day) is sent as an empty date, for the API to
 * refuse, rather than quietly clearing the occasion.
 */
export function draftToOccasion(draft: OccasionDraft): Occasion | null {
  if (draft.kind === 'none') return null;
  if (!draft.yearly) return { kind: draft.kind, date: draft.date, recurrence: null };
  const date =
    draft.month && draft.day ? `${YEARLY_PLACEHOLDER_YEAR}-${draft.month}-${draft.day}` : '';
  return { kind: draft.kind, date, recurrence: 'yearly' };
}
