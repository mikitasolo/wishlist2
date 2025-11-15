/**
 * Utility functions for filtering items
 */

import { IItem } from '@/models/Item';

export type FilterType = 'all' | 'draft' | 'available' | 'booked' | 'bookedByYou' | 'completed';

/**
 * Filters items based on the specified filter type
 */
export function filterItems(
  items: IItem[],
  filter: FilterType,
  currentUserId?: string
): IItem[] {
  switch (filter) {
    case 'all':
      return items;
    case 'draft':
      return items.filter((item) => item.status === 'draft');
    case 'available':
      return items.filter((item) => item.status === 'available');
    case 'booked':
      return items.filter((item) => item.status === 'booked');
    case 'bookedByYou':
      return items.filter(
        (item) => item.status === 'booked' && item.bookedBy === currentUserId
      );
    case 'completed':
      return items.filter((item) => item.status === 'completed');
    default:
      return items;
  }
}

/**
 * Calculates statistics for items in a single pass
 */
export function calculateStats(
  items: IItem[],
  currentUserId?: string
): {
  total: number;
  draft: number;
  available: number;
  booked: number;
  bookedByYou: number;
  completed: number;
} {
  let total = 0;
  let draft = 0;
  let available = 0;
  let booked = 0;
  let bookedByYou = 0;
  let completed = 0;

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
    }
  }

  return { total, draft, available, booked, bookedByYou, completed };
}

/**
 * Sorts items based on the specified sort type
 */
export type SortType = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

export function sortItems(items: IItem[], sortBy: SortType): IItem[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'price-asc':
        // Items without price go to the end
        if (a.priceInCents == null) return 1;
        if (b.priceInCents == null) return -1;
        return a.priceInCents - b.priceInCents;
      case 'price-desc':
        // Items without price go to the end
        if (a.priceInCents == null) return 1;
        if (b.priceInCents == null) return -1;
        return b.priceInCents - a.priceInCents;
      default:
        return 0;
    }
  });
}

