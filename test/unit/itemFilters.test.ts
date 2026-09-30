import { describe, it, expect } from 'vitest';
import {
  filterItemsMulti,
  calculateStats,
  sortItems,
  searchItemsByName,
  compareMostWanted,
  savedWishlistSort,
  isSortType,
  SORT_OPTIONS,
  WISHLIST_SORT_STORAGE_KEY,
} from '@/lib/utils/itemFilters';
import type { ApiItem } from '@/types/api';

const ME = 'user-me';
const OTHER = 'user-other';

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: Math.random().toString(36).slice(2),
    wishlist: 'w1',
    name: 'Item',
    status: 'available',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as ApiItem;
}

describe('filterItemsMulti', () => {
  const items = [
    item({ name: 'draft', status: 'draft' }),
    item({ name: 'avail', status: 'available' }),
    item({ name: 'mine', status: 'booked', bookedBy: ME }),
    item({ name: 'theirs', status: 'booked', bookedBy: OTHER }),
    item({ name: 'done', status: 'completed' }),
    item({ name: 'prop', status: 'proposed', proposedBy: OTHER }),
    item({ name: 'myprop', status: 'proposed', proposedBy: ME }),
  ];

  it('returns everything for empty filters or "all"', () => {
    expect(filterItemsMulti(items, [], ME)).toHaveLength(items.length);
    expect(filterItemsMulti(items, ['all'], ME)).toHaveLength(items.length);
  });

  it('splits booked-by-me vs booked-by-others', () => {
    expect(filterItemsMulti(items, ['bookedByMe'], ME).map((i) => i.name)).toEqual(['mine']);
    expect(filterItemsMulti(items, ['bookedByOthers'], ME).map((i) => i.name)).toEqual(['theirs']);
  });

  it('includes booked items under "available" when includeBookedInAvailable is set (owner view)', () => {
    const owner = filterItemsMulti(items, ['available'], ME, true).map((i) => i.name);
    expect(owner).toEqual(expect.arrayContaining(['avail', 'mine', 'theirs']));
    // without the flag, only truly-available
    expect(filterItemsMulti(items, ['available'], ME, false).map((i) => i.name)).toEqual(['avail']);
  });

  it('supports multiple filters (union)', () => {
    const res = filterItemsMulti(items, ['draft', 'completed'], ME).map((i) => i.name);
    expect(res).toEqual(['draft', 'done']);
  });

  it('proposedByMe only matches the current user’s proposals', () => {
    expect(filterItemsMulti(items, ['proposedByMe'], ME).map((i) => i.name)).toEqual(['myprop']);
  });
});

describe('calculateStats', () => {
  it('counts every status in one pass', () => {
    const items = [
      item({ status: 'draft' }),
      item({ status: 'available' }),
      item({ status: 'booked', bookedBy: ME }),
      item({ status: 'booked', bookedBy: OTHER }),
      item({ status: 'completed' }),
      item({ status: 'proposed', proposedBy: ME }),
    ];
    expect(calculateStats(items, ME)).toEqual({
      total: 6,
      draft: 1,
      available: 1,
      booked: 2,
      bookedByYou: 1,
      completed: 1,
      proposed: 1,
      proposedByYou: 1,
    });
  });
});

describe('sortItems', () => {
  it('sorts by name', () => {
    const items = [item({ name: 'Banana' }), item({ name: 'apple' }), item({ name: 'Cherry' })];
    expect(sortItems(items, 'name-asc').map((i) => i.name)).toEqual(['apple', 'Banana', 'Cherry']);
    expect(sortItems(items, 'name-desc').map((i) => i.name)).toEqual(['Cherry', 'Banana', 'apple']);
  });

  it('sorts by date', () => {
    const items = [
      item({ name: 'new', createdAt: '2024-03-01T00:00:00Z' }),
      item({ name: 'old', createdAt: '2024-01-01T00:00:00Z' }),
    ];
    expect(sortItems(items, 'date-asc').map((i) => i.name)).toEqual(['old', 'new']);
    expect(sortItems(items, 'date-desc').map((i) => i.name)).toEqual(['new', 'old']);
  });

  it('puts items without a price last', () => {
    const items = [
      item({ name: 'noprice', priceInUsdCents: null }),
      item({ name: 'cheap', priceInUsdCents: 100 }),
    ];
    expect(sortItems(items, 'price-asc').map((i) => i.name)).toEqual(['cheap', 'noprice']);
  });

  // Regression: prices were sorted by raw minor units, so 3000 PLN sorted above
  // 2000 USD. Sorting must use the USD-normalised value (priceInUsdCents).
  it('regression: sorts by USD-normalised value, not raw amount', () => {
    const pln3000 = item({
      name: 'PLN 3000',
      price: { value: 300000, currency: 'pln' },
      priceInUsdCents: 75000,
    }); // ~$750
    const usd2000 = item({
      name: 'USD 2000',
      price: { value: 200000, currency: 'usd' },
      priceInUsdCents: 200000,
    }); // $2000
    expect(sortItems([usd2000, pln3000], 'price-asc').map((i) => i.name)).toEqual([
      'PLN 3000',
      'USD 2000',
    ]);
  });
});

describe('sortItems — priority', () => {
  it('puts most-wanted items first, newest first within each group', () => {
    const items = [
      item({ name: 'old plain', createdAt: '2024-01-01T00:00:00Z' }),
      item({ name: 'old wanted', mostWanted: true, createdAt: '2024-01-02T00:00:00Z' }),
      item({ name: 'new plain', createdAt: '2024-03-01T00:00:00Z' }),
      item({ name: 'new wanted', mostWanted: true, createdAt: '2024-03-02T00:00:00Z' }),
    ];
    expect(sortItems(items, 'priority').map((i) => i.name)).toEqual([
      'new wanted',
      'old wanted',
      'new plain',
      'old plain',
    ]);
  });

  // Items saved before the flag existed come back without it.
  it('treats an item with no flag as not most wanted', () => {
    const items = [
      item({ name: 'legacy', createdAt: '2024-03-01T00:00:00Z' }), // no mostWanted
      item({ name: 'unflagged', mostWanted: false, createdAt: '2024-02-01T00:00:00Z' }),
      item({ name: 'wanted', mostWanted: true, createdAt: '2024-01-01T00:00:00Z' }),
    ];
    expect(sortItems(items, 'priority').map((i) => i.name)).toEqual([
      'wanted',
      'legacy',
      'unflagged',
    ]);
  });
});

describe('compareMostWanted', () => {
  it('orders a most-wanted item first and ties everything else', () => {
    expect(compareMostWanted({ mostWanted: true }, { mostWanted: false })).toBeLessThan(0);
    expect(compareMostWanted({}, { mostWanted: true })).toBeGreaterThan(0);
    expect(compareMostWanted({ mostWanted: true }, { mostWanted: true })).toBe(0);
    expect(compareMostWanted({}, { mostWanted: false })).toBe(0);
  });
});

describe('savedWishlistSort', () => {
  const storage = (entries: Record<string, string>) => ({
    getItem: (key: string) => entries[key] ?? null,
  });

  it('defaults to priority when nothing is saved', () => {
    expect(savedWishlistSort(storage({}))).toBe('priority');
  });

  it('returns a sort the visitor picked', () => {
    expect(savedWishlistSort(storage({ [WISHLIST_SORT_STORAGE_KEY]: 'price-asc' }))).toBe(
      'price-asc'
    );
  });

  it('ignores a value that is not a sort', () => {
    expect(savedWishlistSort(storage({ [WISHLIST_SORT_STORAGE_KEY]: 'bogus' }))).toBe('priority');
  });

  // The page used to write the old key on every visit, default or not, so it
  // can't tell a choice apart and mustn't keep anyone off the new default.
  it("ignores the old 'wishlist-sort' key", () => {
    expect(savedWishlistSort(storage({ 'wishlist-sort': 'name-asc' }))).toBe('priority');
  });
});

describe('isSortType', () => {
  it('accepts every offered sort and nothing else', () => {
    for (const { value } of SORT_OPTIONS) expect(isSortType(value)).toBe(true);
    expect(isSortType('bogus')).toBe(false);
    expect(isSortType(null)).toBe(false);
  });
});

describe('searchItemsByName', () => {
  const items = [
    item({ name: 'Sony Headphones' }),
    item({ name: 'Coffee Grinder' }),
    item({ name: 'Grinder Brush' }),
  ];

  it('returns all items for an empty or whitespace query', () => {
    expect(searchItemsByName(items, '')).toHaveLength(3);
    expect(searchItemsByName(items, '   ')).toHaveLength(3);
  });

  it('matches a case-insensitive substring anywhere in the name', () => {
    expect(searchItemsByName(items, 'grinder').map((i) => i.name)).toEqual([
      'Coffee Grinder',
      'Grinder Brush',
    ]);
    expect(searchItemsByName(items, 'SONY').map((i) => i.name)).toEqual(['Sony Headphones']);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(searchItemsByName(items, '  coffee  ').map((i) => i.name)).toEqual(['Coffee Grinder']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchItemsByName(items, 'zzz')).toEqual([]);
  });

  it('does not throw on an item with no name', () => {
    const nameless = [item({ name: undefined as unknown as string })];
    expect(searchItemsByName(nameless, 'x')).toEqual([]);
  });
});
