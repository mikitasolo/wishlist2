import { addDays, isCalendarDate, nextOccurrence, type Occasion } from '@/lib/utils/occasion';
import type { ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import type { Visibility } from '@/lib/utils/visibility';

/**
 * When a share link stops working, as the owners' New link and Edit dialogs
 * offer it (WIS-335). Pure and client-safe: the API takes whatever expiry it's
 * sent, so the presets and defaults live here.
 *
 * **A date means "from the start of that day"**: a link given a calendar date
 * (Custom, or Day after the occasion) stops working at the viewer's local
 * midnight that begins it, so it works through the day before. "Expires 12 Jun"
 * names that same date. 1 week and 1 month count from the moment it's saved.
 */

export const SHARE_LINK_EXPIRY_PRESETS = ['never', 'week', 'month', 'occasion', 'custom'] as const;
export type ShareLinkExpiryPreset = (typeof SHARE_LINK_EXPIRY_PRESETS)[number];

export const SHARE_LINK_EXPIRY_LABELS: Record<ShareLinkExpiryPreset, string> = {
  never: 'Never',
  week: '1 week',
  month: '1 month',
  occasion: 'Day after the occasion',
  custom: 'Custom',
};

/**
 * The day after the occasion's next occurrence (`YYYY-MM-DD`), counted from
 * `today` (the viewer's local date), or `null` without one: no occasion, or a
 * one-off that has passed. A link given it works through the occasion itself.
 */
export function dayAfterOccasion(
  occasion: Occasion | null | undefined,
  today: string
): string | null {
  if (!occasion) return null;
  const next = nextOccurrence(occasion.date, occasion.recurrence, today);
  return next ? addDays(next, 1) : null;
}

/** The presets on offer: Day after the occasion only while there's one ahead. */
export function expiryPresetsFor(
  occasion: Occasion | null | undefined,
  today: string
): ShareLinkExpiryPreset[] {
  const hasOccasion = dayAfterOccasion(occasion, today) !== null;
  return SHARE_LINK_EXPIRY_PRESETS.filter((p) => p !== 'occasion' || hasOccasion);
}

/** A new link's expiry: Join links end the day after the occasion (Never without one); View links never do. */
export function defaultExpiryPreset(
  level: ShareLinkLevel,
  hasOccasion: boolean
): ShareLinkExpiryPreset {
  return level === 'join' && hasOccasion ? 'occasion' : 'never';
}

/** A new link's level: Join on a Public list (anyone can already view it), else View. */
export function defaultLevel(visibility: Visibility): ShareLinkLevel {
  return visibility === 'everyone' ? 'join' : 'view';
}

/** Local midnight at the start of `date` (`YYYY-MM-DD`), or `null` for anything else. */
export function startOfLocalDay(date: string): Date | null {
  if (!isCalendarDate(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** `now` moved a month on, kept to the last day of a shorter month (Jan 31 → Feb 28). */
function addOneMonth(now: Date): Date {
  const next = new Date(now);
  const day = now.getDate();
  next.setDate(1);
  next.setMonth(now.getMonth() + 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

/**
 * The `expiresAt` a preset gives, as an ISO date-time (what the API takes), or
 * `null` for Never. `undefined` when it can't give one: Day after the occasion
 * without an occasion ahead, or a Custom date that's missing, not a real date
 * or not after `today` (the link would be dead on arrival).
 */
export function expiryFor(
  preset: ShareLinkExpiryPreset,
  {
    now,
    today,
    occasion,
    customDate,
  }: { now: Date; today: string; occasion?: Occasion | null; customDate?: string }
): string | null | undefined {
  switch (preset) {
    case 'never':
      return null;
    case 'week':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month':
      return addOneMonth(now).toISOString();
    case 'occasion': {
      const day = dayAfterOccasion(occasion, today);
      return day ? (startOfLocalDay(day)?.toISOString() ?? undefined) : undefined;
    }
    case 'custom': {
      if (!customDate || !isCalendarDate(customDate) || customDate <= today) return undefined;
      return startOfLocalDay(customDate)?.toISOString() ?? undefined;
    }
  }
}

/** Whether a link has expired by `now` (`expiresAt` at or before it). */
export function isLinkExpired(link: { expiresAt: string | null }, now: Date): boolean {
  return !!link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime();
}

/**
 * Whether saving `newExpiresAt` brings an expired link back: everyone who has
 * it can open the list again, so the Edit dialog says so.
 */
export function isRevival(
  link: { expiresAt: string | null },
  newExpiresAt: string | null,
  now: Date
): boolean {
  if (!isLinkExpired(link, now)) return false;
  return newExpiresAt === null || new Date(newExpiresAt).getTime() > now.getTime();
}

/**
 * A link's expiry as its row says it: "Expires 12 Jun" (the year only when
 * it isn't this one), "Expired", or `null` for a link that never expires.
 * `locale` is the viewer's by default.
 */
export function formatLinkExpiry(
  link: { expiresAt: string | null },
  now: Date,
  locale?: string
): string | null {
  if (!link.expiresAt) return null;
  if (isLinkExpired(link, now)) return 'Expired';
  const at = new Date(link.expiresAt);
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
  return `Expires ${date}`;
}

/** The local calendar date (`YYYY-MM-DD`) an expiry falls on, for the Custom date field. */
export function expiryDateString(expiresAt: string): string {
  const at = new Date(expiresAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
