/**
 * How each item status looks, in one place: its label, tone, icon and
 * classes, for the viewer's role. Every surface that shows a status reads it
 * from here (the item card's badge and border, the stat tiles and status
 * filter on a list and on /items, /items' badges, the Booked page, the
 * notices in the item forms), so a status has one colour and one name
 * everywhere, and renaming one is a change to this file.
 *
 * The colours are the status tokens in `app/globals.css` (`bg-success-fill`,
 * `text-warning`, …). Never colour a status with raw palette classes
 * (`emerald-*`, `amber-*`, `green-*`, `blue-*`, `yellow-*`).
 *
 * Owners never see booking status: for an owner, `booked` is `available`, and
 * nothing here gives them a booked label or tone.
 */
import type { IconName } from '@/components/Icon';
import type { ApiItem } from '@/types/api';
import type { FilterOption } from '@/lib/utils/itemFilters';

export type ItemStatus = ApiItem['status'];

/** Who is looking: the same roles as the status filter's. */
export type ViewerRole = 'owner' | 'member' | 'visitor';

/** An item's status as a viewer sees it. */
export type DisplayStatus =
  'draft' | 'proposed' | 'available' | 'bookedByMe' | 'bookedByOthers' | 'completed';

/**
 * - `neutral`: nothing to say (available).
 * - `info`: proposed, and informational notices.
 * - `success`: booked by you, the Book button, success toasts.
 * - `warning`: booked by someone else, things that need the viewer's attention.
 * - `danger`: destructive actions and errors.
 * - `done`: completed (received). Neutral on purpose, so it can't be mistaken
 *   for "Booked by you", which is green.
 * - `draft`: not published yet.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'done' | 'draft';

export interface ToneClasses {
  /** A badge's colours: a solid fill and its text (shape and size are the caller's). */
  badge: string;
  /** Coloured text on a surface (a stat tile's number, an icon). */
  text: string;
  /** An item card's border (and ring), replacing its default border colour. */
  card: string;
  /** A soft chip or button: the tone's tint with its text. */
  tint: string;
  /** A notice box: border, tint and text (shape and padding are the caller's). */
  notice: string;
}

// Every pair here clears 4.5:1 in both themes (the WIS-234 PR lists them).
export const TONE_CLASSES: Record<StatusTone, ToneClasses> = {
  neutral: {
    badge: 'border border-border bg-surface text-foreground',
    text: 'text-foreground',
    card: 'border-border',
    tint: 'bg-muted text-foreground',
    notice: 'border border-border bg-surface-2 text-foreground',
  },
  info: {
    badge: 'bg-info-fill text-white',
    text: 'text-info',
    card: 'border-info/60 ring-1 ring-info/30',
    tint: 'bg-info/12 text-info',
    notice: 'border border-info/20 bg-info/10 text-info',
  },
  success: {
    badge: 'bg-success-fill text-white',
    text: 'text-success',
    card: 'border-success/60 ring-1 ring-success/30',
    tint: 'bg-success/12 text-success',
    notice: 'border border-success/20 bg-success/10 text-success',
  },
  warning: {
    badge: 'bg-warning-fill text-white',
    text: 'text-warning',
    card: 'border-warning/60 ring-1 ring-warning/30',
    tint: 'bg-warning/15 text-warning',
    notice: 'border border-warning/30 bg-warning/10 text-warning',
  },
  danger: {
    badge: 'bg-danger-fill text-white',
    text: 'text-danger',
    card: 'border-danger/60 ring-1 ring-danger/30',
    tint: 'bg-danger/15 text-danger',
    notice: 'border border-danger/20 bg-danger/10 text-danger',
  },
  done: {
    badge: 'bg-foreground text-background',
    text: 'text-foreground',
    card: 'border-foreground/30',
    tint: 'bg-foreground/8 text-foreground',
    notice: 'border border-border-strong bg-surface-2 text-foreground',
  },
  draft: {
    badge: 'border border-dashed border-border-strong bg-surface-2 text-muted-foreground',
    text: 'text-muted-foreground',
    card: 'border-dashed border-border-strong',
    tint: 'bg-surface-2 text-muted-foreground',
    notice: 'border border-dashed border-border-strong bg-surface-2 text-muted-foreground',
  },
};

export interface StatusMeta {
  status: DisplayStatus;
  /** The status's name on a badge. */
  label: string;
  /** Its name on a stat tile and in the status filter, which count items of it. */
  filterLabel: string;
  tone: StatusTone;
  /** The badge's icon, so a status never rests on its colour alone. */
  icon: IconName | null;
  /** Whether an item card shows a badge for it (an available item has none). */
  badge: boolean;
  classes: ToneClasses;
}

function meta(
  status: DisplayStatus,
  label: string,
  filterLabel: string,
  tone: StatusTone,
  icon: IconName | null,
  badge = true
): StatusMeta {
  return { status, label, filterLabel, tone, icon, badge, classes: TONE_CLASSES[tone] };
}

export const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  draft: meta('draft', 'Draft', 'Draft', 'draft', 'note'),
  proposed: meta('proposed', 'Proposed', 'Proposed', 'info', 'sparkles'),
  available: meta('available', 'Available', 'Available', 'neutral', null, false),
  bookedByMe: meta('bookedByMe', 'Booked by you', 'Booked by You', 'success', 'gift'),
  bookedByOthers: meta('bookedByOthers', 'Booked', 'Booked by Others', 'warning', 'lock'),
  completed: meta('completed', 'Completed', 'Completed', 'done', 'check'),
};

/**
 * An item's status as `role` sees it. A booked item is the viewer's own or
 * someone else's, except to an owner, who never sees booking: to them it's
 * available, whoever booked it.
 */
export function displayStatus(
  status: ItemStatus,
  role: ViewerRole,
  bookedByViewer = false
): DisplayStatus {
  if (status !== 'booked') return status;
  if (role === 'owner') return 'available';
  return bookedByViewer ? 'bookedByMe' : 'bookedByOthers';
}

/** How an item's status looks to `role` (see `displayStatus`). */
export function statusMeta(
  status: ItemStatus,
  role: ViewerRole,
  { bookedByViewer = false }: { bookedByViewer?: boolean } = {}
): StatusMeta {
  return STATUS_META[displayStatus(status, role, bookedByViewer)];
}

/** A status filter option's (and its stat tile's) label and tone. */
export interface FilterMeta {
  label: string;
  tone: StatusTone;
}

const fromStatus = (status: DisplayStatus): FilterMeta => ({
  label: STATUS_META[status].filterLabel,
  tone: STATUS_META[status].tone,
});

export const FILTER_META: Record<FilterOption, FilterMeta> = {
  all: { label: 'All', tone: 'neutral' },
  draft: fromStatus('draft'),
  proposed: fromStatus('proposed'),
  available: fromStatus('available'),
  bookedByMe: fromStatus('bookedByMe'),
  bookedByOthers: fromStatus('bookedByOthers'),
  proposedByMe: { label: 'Proposed by You', tone: STATUS_META.proposed.tone },
  completed: fromStatus('completed'),
};
