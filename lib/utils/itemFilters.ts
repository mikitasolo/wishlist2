/**
 * Searching and sorting item grids. Both item pages filter by status with the
 * status chips (`lib/utils/listChips.ts`).
 */

import { ApiItem } from '@/types/api';

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

/** The key an earlier version saved the /items List filter under. */
const OLD_LIST_FILTER_STORAGE_KEY = 'items-wishlist-filters';

/** Deletes the List filter an earlier version saved, so it can't hide new lists. */
export function forgetSavedListFilter(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(OLD_LIST_FILTER_STORAGE_KEY);
}

/** Deletes every status filter an earlier version of the app saved. */
export function forgetSavedStatusFilters(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of OLD_STATUS_FILTER_STORAGE_KEYS) storage.removeItem(key);
}

/**
 * Filters items to those whose name or notes contain the query (case-insensitive
 * substring match, WIS-389). An empty or whitespace-only query returns all items.
 * It reads only `name` and `notes`, never a booking or proposer field, so it can
 * show an owner nothing the item's serialized form didn't already carry. A caller's
 * `extraText` must be as public to the viewer (the list's name), never a booking
 * or proposer field.
 */
export function searchItems<T extends { name?: string | null; notes?: string | null }>(
  items: T[],
  query: string,
  /** More text each item answers to (/items adds its list's name, WIS-423). */
  extraText?: (item: T) => string | null | undefined
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name?.toLowerCase().includes(q) ||
      item.notes?.toLowerCase().includes(q) ||
      extraText?.(item)?.toLowerCase().includes(q)
  );
}

/** The ways an item grid can be sorted (see `sortItems`). */
export type SortType =
  'priority' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'date-asc' | 'date-desc';

// The sort choices both item grids offer (the wishlist page and /items).
export const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: 'priority', label: 'Most wanted first' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
  { value: 'date-asc', label: 'Date created (oldest first)' },
  { value: 'date-desc', label: 'Date created (newest first)' },
];

/**
 * Each sort's name on a toolbar's trigger, which has to fit beside a search
 * field on a phone (the wishlist page's). The menu keeps `SORT_OPTIONS`' labels.
 */
export const SORT_SHORT_LABELS: Record<SortType, string> = {
  priority: 'Most wanted',
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A',
  'price-asc': 'Lowest price',
  'price-desc': 'Highest price',
  'date-asc': 'Oldest first',
  'date-desc': 'Newest first',
};

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
