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

/**
 * Sorts items based on the specified sort type
 */
export type SortType =
  'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'date-asc' | 'date-desc';

export function sortItems(items: ApiItem[], sortBy: SortType): ApiItem[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'price-asc': {
        // Items without price go to the end
        // Use priceInUsdCents (enriched by API)
        const aPrice = a.priceInUsdCents ?? null;
        const bPrice = b.priceInUsdCents ?? null;
        if (aPrice == null) return 1;
        if (bPrice == null) return -1;
        return aPrice - bPrice;
      }
      case 'price-desc': {
        // Items without price go to the end
        // Use priceInUsdCents (enriched by API)
        const aPrice = a.priceInUsdCents ?? null;
        const bPrice = b.priceInUsdCents ?? null;
        if (aPrice == null) return 1;
        if (bPrice == null) return -1;
        return bPrice - aPrice;
      }
      case 'date-asc': {
        // Oldest first
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateA.getTime() - dateB.getTime();
      }
      case 'date-desc': {
        // Newest first
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      }
      default:
        return 0;
    }
  });
}
