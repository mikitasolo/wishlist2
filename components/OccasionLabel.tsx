'use client';

import Icon from '@/components/Icon';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import {
  formatCalendarDate,
  formatOccasionLabel,
  nextOccurrence,
  occasionKindLabel,
  type Occasion,
} from '@/lib/utils/occasion';

// How the icon and text sit together; always applied.
const LAYOUT = 'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap';
// How it looks, which a caller can replace (e.g. on a cover image).
const PILL =
  'rounded-full border border-border bg-surface px-2.5 py-1 text-badge font-semibold text-foreground shadow-xs';

/** The look over a cover image, like the other badges on a list's card. Add the position. */
export const OCCASION_ON_COVER =
  'rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-badge font-semibold text-white backdrop-blur-md';

/**
 * A list's occasion with its countdown, e.g. "Birthday · in 12 days", for
 * whoever can see the list. Nothing for a list without one.
 *
 * The countdown runs from the viewer's local date, so until that's known (a
 * server render, and the render that hydrates it) only the kind shows, which
 * is the same on both sides. The exact date is in its tooltip. `className`
 * replaces the pill's look (border, colors, padding, text size), not the
 * layout of its icon and text.
 */
export default function OccasionLabel({
  occasion,
  className = PILL,
}: {
  occasion?: Occasion | null;
  className?: string;
}) {
  const today = useLocalToday();
  if (!occasion) return null;

  const next = today ? nextOccurrence(occasion.date, occasion.recurrence, today) : null;
  // The day it next falls on, or (a passed one-off) the day it was. A yearly
  // one's stored date is on the placeholder year, so it's never shown, not even
  // in `dateTime` before the next one is known.
  const shown = next ?? (occasion.recurrence === 'yearly' ? undefined : occasion.date);
  return (
    <span
      className={`${LAYOUT} ${className}`}
      title={today && shown ? formatCalendarDate(shown) : undefined}
    >
      <Icon name="calendar" size={12} />
      <time dateTime={shown}>
        {today ? formatOccasionLabel(occasion, today) : occasionKindLabel(occasion.kind)}
      </time>
    </span>
  );
}
