/**
 * Utility functions for filtering items
 */

import { ApiItem } from '@/types/api';

export type FilterOption =
  | 'all'
  | 'draft'
  | 'available'
  | 'bookedByMe'
  | 'bookedByOthers'
  | 'completed'
  | 'proposed'
  | 'proposedByMe';

/**
 * Filters items based on multiple selected filter options
 * @param items - Array of items to filter
 * @param selectedFilters - Array of selected filter options
 * @param currentUserId - Current user ID for user-specific filters
 * @param includeBookedInAvailable - If true, "available" filter includes both "available" and "booked" statuses
 */
export function filterItemsMulti(
  items: ApiItem[],
  selectedFilters: FilterOption[],
  currentUserId?: string,
  includeBookedInAvailable: boolean = false
): ApiItem[] {
  // If no filters selected or "all" is selected, return all items
  if (selectedFilters.length === 0 || selectedFilters.includes('all')) {
    return items;
  }

  return items.filter((item) => {
    return selectedFilters.some((filter) => {
      switch (filter) {
        case 'draft':
          return item.status === 'draft';
        case 'available':
          if (includeBookedInAvailable) {
            // For owner/non-member: "available" includes both available and booked
            return item.status === 'available' || item.status === 'booked';
          }
          return item.status === 'available';
        case 'bookedByMe':
          return item.status === 'booked' && item.bookedBy === currentUserId;
        case 'bookedByOthers':
          return (
            item.status === 'booked' && item.bookedBy !== currentUserId && item.bookedBy != null
          );
        case 'completed':
          return item.status === 'completed';
        case 'proposed':
          return item.status === 'proposed';
        case 'proposedByMe':
          return item.status === 'proposed' && item.proposedBy === currentUserId;
        default:
          return false;
      }
    });
  });
}

/** Who is looking at a list, as far as its status filter goes. */
export type FilterRole = 'owner' | 'member' | 'visitor';

/**
 * The status filter's options for a role, in the order the stat cards above
 * the list render, so the dropdown and the cards line up one-to-one. An
 * owner's never mention booking: they don't see it, so a booked item is
 * "available" to them.
 */
export function statusFilterOptions(role: FilterRole): FilterOption[] {
  switch (role) {
    case 'owner':
      return ['all', 'draft', 'proposed', 'available', 'completed'];
    case 'member':
      return ['all', 'available', 'bookedByMe', 'bookedByOthers', 'proposedByMe', 'completed'];
    case 'visitor':
      return ['all', 'available', 'completed'];
  }
}

/** What the status filter shows on a list the viewer has just opened. */
export function defaultStatusFilters(role: FilterRole): FilterOption[] {
  switch (role) {
    case 'owner':
      return ['draft', 'available', 'proposed'];
    case 'member':
      return ['available', 'bookedByMe', 'proposedByMe'];
    case 'visitor':
      return ['available'];
  }
}

/**
 * The status filter's selection once `option` is ticked or unticked.
 * Ticking All, or every other option, selects everything. Unticking All, or
 * the last option ticked, goes back to `defaults` rather than to an empty
 * selection: `filterItemsMulti` shows every item for one, so a filter that
 * said "None selected" would show them all.
 */
export function toggleStatusFilter(
  selected: FilterOption[],
  option: FilterOption,
  options: FilterOption[],
  defaults: FilterOption[]
): FilterOption[] {
  const others = options.filter((o) => o !== 'all');
  if (option === 'all') {
    return isEveryStatusSelected(selected, options) ? [...defaults] : [...options];
  }
  const next = selected.includes(option)
    ? selected.filter((f) => f !== option && f !== 'all')
    : [...selected.filter((f) => f !== 'all'), option];
  if (others.every((o) => next.includes(o))) return [...options];
  return next.length > 0 ? next : [...defaults];
}

/**
 * Whether a selection shows every item: All, every other option, or nothing
 * at all (which `filterItemsMulti` reads as no filter).
 */
export function isEveryStatusSelected(selected: FilterOption[], options: FilterOption[]): boolean {
  return (
    selected.length === 0 ||
    selected.includes('all') ||
    options.filter((o) => o !== 'all').every((o) => selected.includes(o))
  );
}

/**
 * Where the status filter used to be saved: one key per role on the wishlist
 * page, which carried a filter picked on one list (a stat card's click
 * included) to every other list, and one on the items page. The filter isn't
 * saved any more, so a page that has one deletes these when it opens, and a
 * value left in them can't come back.
 */
export const OLD_STATUS_FILTER_STORAGE_KEYS = [
  'wishlist-filters-owner',
  'wishlist-filters-member',
  'wishlist-filters-nonmember',
  'items-status-filters',
] as const;

/** Deletes every status filter an earlier version of the app saved. */
export function forgetSavedStatusFilters(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of OLD_STATUS_FILTER_STORAGE_KEYS) storage.removeItem(key);
}

/**
 * Filters items to those whose name contains the query (case-insensitive
 * substring match). An empty or whitespace-only query returns all items.
 */
export function searchItemsByName(items: ApiItem[], query: string): ApiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name?.toLowerCase().includes(q));
}

/**
 * Calculates statistics for items in a single pass
 */
export function calculateStats(
  items: ApiItem[],
  currentUserId?: string
): {
  total: number;
  draft: number;
  available: number;
  booked: number;
  bookedByYou: number;
  completed: number;
  proposed: number;
  proposedByYou: number;
} {
  let total = 0;
  let draft = 0;
  let available = 0;
  let booked = 0;
  let bookedByYou = 0;
  let completed = 0;
  let proposed = 0;
  let proposedByYou = 0;

  for (const item of items) {
    total++;
    if (item.status === 'draft') {
      draft++;
    } else if (item.status === 'available') {
      available++;
    } else if (item.status === 'booked') {
      booked++;
      if (item.bookedBy === currentUserId) {
        bookedByYou++;
      }
    } else if (item.status === 'completed') {
      completed++;
    } else if (item.status === 'proposed') {
      proposed++;
      if (item.proposedBy === currentUserId) {
        proposedByYou++;
      }
    }
  }

  return { total, draft, available, booked, bookedByYou, completed, proposed, proposedByYou };
}

/** The ways an item grid can be sorted (see `sortItems`). */
export type SortType =
  'priority' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'date-asc' | 'date-desc';

// The sort choices both item grids offer (the wishlist page and /items).
export const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: 'priority', label: 'Most Wanted First' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'price-asc', label: 'Price (Low to High)' },
  { value: 'price-desc', label: 'Price (High to Low)' },
  { value: 'date-asc', label: 'Date Created (Oldest First)' },
  { value: 'date-desc', label: 'Date Created (Newest First)' },
];

export function isSortType(value: unknown): value is SortType {
  return SORT_OPTIONS.some((o) => o.value === value);
}

// The wishlist page's sort when the visitor hasn't picked one.
export const DEFAULT_WISHLIST_SORT: SortType = 'priority';

// Holds only a sort the visitor picked. It replaces 'wishlist-sort', which the
// page wrote on every visit, so its value can't tell a choice from the default.
export const WISHLIST_SORT_STORAGE_KEY = 'wishlist-sort-choice';

/** The visitor's saved wishlist sort, or the default when there isn't a valid one. */
export function savedWishlistSort(storage: Pick<Storage, 'getItem'>): SortType {
  const stored = storage.getItem(WISHLIST_SORT_STORAGE_KEY);
  return isSortType(stored) ? stored : DEFAULT_WISHLIST_SORT;
}

/**
 * Most-wanted items before the rest. An item with no flag (saved before it
 * existed) counts as not most wanted. Returns 0 between two items of the same
 * kind, so a caller breaks the tie.
 */
export function compareMostWanted(
  a: { mostWanted?: boolean },
  b: { mostWanted?: boolean }
): number {
  return Number(b.mostWanted === true) - Number(a.mostWanted === true);
}

/**
 * What the sorts read. Both item grids' items have it: the wishlist page's
 * (`ApiItem`) and the /items page's (`/api/users/me/items`), so the two share
 * one sorter and can't drift apart.
 */
export interface SortableItem {
  name: string;
  priceInUsdCents?: number | null;
  mostWanted?: boolean;
  createdAt: string; // ISO date string
}

/**
 * Older item first, by `createdAt`: the sorts' one notion of when an item was
 * created, and the time both item reads already order by on the server.
 */
function compareCreated(a: SortableItem, b: SortableItem): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/**
 * Cheaper item first, by the USD-normalised `priceInUsdCents` so prices in
 * different currencies compare. A free item (0) is priced. An item without a
 * price (null, or no rate for its currency) goes after every priced one in
 * either direction, and two of them compare equal so the sort keeps their order.
 */
function comparePrice(a: SortableItem, b: SortableItem, direction: 1 | -1): number {
  const aPrice = a.priceInUsdCents ?? null;
  const bPrice = b.priceInUsdCents ?? null;
  if (aPrice === null || bPrice === null) {
    return Number(aPrice === null) - Number(bPrice === null);
  }
  return direction * (aPrice - bPrice);
}

/**
 * Orders two items for the given sort: negative when `a` comes first, 0 for a
 * tie. Every sort has a case and there is no default, so a new `SortType`
 * without one fails the typecheck.
 */
export function compareItems(a: SortableItem, b: SortableItem, sortBy: SortType): number {
  switch (sortBy) {
    case 'priority':
      // Most wanted first, newest first within each group.
      return compareMostWanted(a, b) || compareCreated(b, a);
    case 'name-asc':
      return a.name.localeCompare(b.name);
    case 'name-desc':
      return b.name.localeCompare(a.name);
    case 'price-asc':
      return comparePrice(a, b, 1);
    case 'price-desc':
      return comparePrice(a, b, -1);
    case 'date-asc':
      return compareCreated(a, b);
    case 'date-desc':
      return compareCreated(b, a);
  }
}

/** A sorted copy of `items`; items that tie keep their order. */
export function sortItems<T extends SortableItem>(items: T[], sortBy: SortType): T[] {
  return [...items].sort((a, b) => compareItems(a, b, sortBy));
}
