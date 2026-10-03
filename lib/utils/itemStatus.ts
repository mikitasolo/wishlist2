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
import { TONE_CLASSES, type StatusTone, type ToneClasses } from '@/lib/utils/statusTones';

export type ItemStatus = ApiItem['status'];

/** Who is looking: the same roles as the status filter's. */
export type ViewerRole = 'owner' | 'member' | 'visitor';

/** An item's status as a viewer sees it. */
export type DisplayStatus =
  'draft' | 'proposed' | 'available' | 'bookedByMe' | 'bookedByOthers' | 'completed';

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
