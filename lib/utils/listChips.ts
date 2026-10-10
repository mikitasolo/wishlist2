/**
 * The row of status chips over a list's items (D7): one single-select row with
 * a count on each chip, which replaced the stat tiles and the Status dropdown.
 *
 * - An owner's chips are All · Drafts · Proposals · Live · Received. Live is the
 *   published items that aren't received: a booked item is in it, because an
 *   owner never sees booking (`displayStatus` folds it into available), so no
 *   chip or count tells an owner what's been reserved.
 * - A member's are All · Available · Reserved by you · Your proposals. Nothing
 *   counts what someone else reserved apart from All, and nothing counts anyone
 *   else's proposal: a member is never sent one, and one that reached the page
 *   anyway would be left out of every chip, All included.
 * - A visitor gets no chips: All is the only view.
 *
 * Every list opens on All. A chip is a question about the list in front of
 * you, so it's never saved (only the URL's `?show=` keeps it, for back and
 * refresh), and nothing carries over to the next list.
 *
 * Under All the actionable items come first, each group in the viewer's sort
 * (`orderListItems`), and the ones nobody can act on any more are dimmed
 * (`isDimmedInAll`).
 */
import {
  displayStatus,
  STATUS_META,
  type DisplayStatus,
  type ViewerRole,
} from '@/lib/utils/itemStatus';
import { isPublishedItem } from '@/lib/utils/itemCounts';
import { compareItems, type SortableItem, type SortType } from '@/lib/utils/itemFilters';
import type { ApiItem } from '@/types/api';

/** A chip's id, which is also its `?show=` value (All has none). */
export type ListChip =
  | 'all'
  | 'drafts'
  | 'proposals'
  | 'live'
  | 'received'
  | 'available'
  | 'reserved-by-you'
  | 'your-proposals';

/** The `?show=` parameter that names the chip a list is shown on. */
export const LIST_CHIP_PARAM = 'show';

/** The `?q=` parameter that holds a list's item search (WIS-389). */
export const LIST_SEARCH_PARAM = 'q';

/** Each chip's name. The statuses' come from the status map. */
export const LIST_CHIP_LABELS: Record<ListChip, string> = {
  all: 'All',
  drafts: 'Drafts',
  proposals: 'Proposals',
  live: 'Live',
  received: STATUS_META.completed.filterLabel,
  available: STATUS_META.available.filterLabel,
  'reserved-by-you': STATUS_META.bookedByMe.filterLabel,
  'your-proposals': 'Your proposals',
};

const CHIPS: Record<ViewerRole, readonly ListChip[]> = {
  owner: ['all', 'drafts', 'proposals', 'live', 'received'],
  member: ['all', 'available', 'reserved-by-you', 'your-proposals'],
  visitor: [],
};

/** The chips a role gets, in the order they're shown. None for a visitor. */
export function listChips(role: ViewerRole): readonly ListChip[] {
  return CHIPS[role];
}

/** What a list item needs to be sorted into a chip. */
export type ChipItem = Pick<ApiItem, 'status' | 'bookedBy' | 'proposedBy' | 'groupGift'>;

/**
 * How an item looks to this viewer, or null when it isn't theirs to see: a
 * draft to anyone but an owner, a proposal to anyone but the owners and its
 * proposer. The items API already leaves those out; this keeps them out of a
 * count even if one got through.
 */
function viewOf(item: ChipItem, role: ViewerRole, viewerId: string | null): DisplayStatus | null {
  if (role !== 'owner') {
    if (item.status === 'draft') return null;
    if (item.status === 'proposed' && !(viewerId && item.proposedBy === viewerId)) return null;
  }
  // A contributor to a group gift (WIS-362) holds the item as much as the organizer
  // does, though only the organizer is `bookedBy`.
  const holds = !!viewerId && item.bookedBy === viewerId;
  return displayStatus(item.status, role, holds || item.groupGift?.contributing === true);
}

/** The chip, other than All, an item seen as `view` is under, if any. */
function chipFor(item: ChipItem, view: DisplayStatus, role: ViewerRole): ListChip | null {
  if (role === 'owner') {
    if (view === 'draft') return 'drafts';
    if (view === 'proposed') return 'proposals';
    if (view === 'completed') return 'received';
    // Published and not received, whoever may have reserved it: the rule
    // "N items" counts by (`isPublishedItem`), less Received.
    return isPublishedItem(item.status) ? 'live' : null;
  }
  if (role === 'member') {
    if (view === 'available') return 'available';
    if (view === 'bookedByMe') return 'reserved-by-you';
    if (view === 'proposed') return 'your-proposals';
  }
  return null;
}

/**
 * The chip a list is on: `value` (a `?show=`, or a chip picked earlier) when
 * it's one of this role's chips, otherwise All.
 */
export function listChipFor(value: string | null | undefined, role: ViewerRole): ListChip {
  const chips = listChips(role);
  return chips.includes(value as ListChip) ? (value as ListChip) : 'all';
}

/** How many items each of the role's chips shows (a chip it doesn't get: 0). */
export function countListChips(
  items: Iterable<ChipItem>,
  role: ViewerRole,
  viewerId: string | null
): Record<ListChip, number> {
  const counts = Object.fromEntries(
    Object.keys(LIST_CHIP_LABELS).map((chip) => [chip, 0])
  ) as Record<ListChip, number>;
  for (const item of items) {
    const view = viewOf(item, role, viewerId);
    if (view === null) continue;
    counts.all++;
    const chip = chipFor(item, view, role);
    if (chip) counts[chip]++;
  }
  return counts;
}

/**
 * The order of the groups under All: what the viewer can act on first.
 * An owner: proposals to review, drafts to publish, live items, then received
 * ones. A member: available, their own reservations and proposals, then what
 * someone else has reserved, then what's been received. A visitor: available,
 * then received.
 */
const ALL_ORDER: Record<ViewerRole, readonly DisplayStatus[]> = {
  owner: ['proposed', 'draft', 'available', 'completed'],
  member: ['available', 'bookedByMe', 'proposed', 'bookedByOthers', 'completed'],
  visitor: ['available', 'completed'],
};

/** Statuses no one can act on any more, shown dimmed under All. */
const DIMMED: ReadonlySet<DisplayStatus> = new Set<DisplayStatus>(['bookedByOthers', 'completed']);

/**
 * Whether an item is dimmed under All: reserved by someone else (a member's
 * view only) or received.
 */
export function isDimmedInAll(item: ChipItem, role: ViewerRole, viewerId: string | null): boolean {
  const view = viewOf(item, role, viewerId);
  // A group gift someone else started is still there to join: not dimmed.
  if (view === 'bookedByOthers' && item.groupGift) return false;
  return view !== null && DIMMED.has(view);
}

/**
 * The items shown under `chip`, in order: grouped as above (which only matters
 * under All, since every other chip is one group), and in the viewer's sort
 * within each group. Items that tie keep their order.
 */
export function orderListItems<T extends ChipItem & SortableItem>(
  items: T[],
  chip: ListChip,
  role: ViewerRole,
  viewerId: string | null,
  sortBy: SortType
): T[] {
  const order = ALL_ORDER[role];
  const shown: { item: T; group: number }[] = [];
  for (const item of items) {
    const view = viewOf(item, role, viewerId);
    if (view === null || (chip !== 'all' && chipFor(item, view, role) !== chip)) continue;
    const at = order.indexOf(view);
    shown.push({ item, group: at === -1 ? order.length : at });
  }
  return shown
    .sort((a, b) => a.group - b.group || compareItems(a.item, b.item, sortBy))
    .map(({ item }) => item);
}

/** The grid's first cell: an owner's Add item tile, or a member's Propose an item. */
export type AddTile = 'add' | 'propose';

// The chips a role's tile shows under: the ones a new item (or proposal) is
// sure to be listed in. An owner's new item is live or a draft, as its form
// says, so only All is certain; a member's proposal is always one of theirs.
const ADD_TILE_CHIPS: Record<ViewerRole, readonly ListChip[]> = {
  owner: ['all'],
  member: ['all', 'your-proposals'],
  visitor: [],
};

/**
 * Which add tile the grid starts with, if any: an owner's `add`, a member's
 * `propose`, and none for a visitor. Only under a chip the new item is sure to
 * be listed in, and not while a search narrows the grid, which the new item
 * may not match.
 */
export function addTileFor(role: ViewerRole, chip: ListChip, searching: boolean): AddTile | null {
  if (searching || !ADD_TILE_CHIPS[role].includes(chip)) return null;
  return role === 'owner' ? 'add' : 'propose';
}
