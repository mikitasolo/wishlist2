// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useListFilters, type ListFiltersOptions } from '@/lib/hooks/useListFilters';
import { resetDiscreetModeForTests, setDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { WISHLIST_SORT_STORAGE_KEY } from '@/lib/utils/itemFilters';
import type { ApiItem } from '@/types/api';

function item(id: string, status: ApiItem['status'], extra: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: id,
    wishlist: 'w1',
    name: id,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as ApiItem;
}

const ITEMS = [
  item('mine', 'booked', { bookedBy: 'me', price: { value: 9000, currency: 'USD' } }),
  item('cheap', 'available', { price: { value: 1000, currency: 'USD' } }),
];

function setup(overrides: Partial<ListFiltersOptions> = {}) {
  const options: ListFiltersOptions = {
    list: { id: 'w1', slug: null },
    wishlistId: 'w1',
    viewerRole: 'member',
    viewerId: 'me',
    isOwner: false,
    isMember: true,
    defaultCurrency: 'USD',
    items: ITEMS,
    itemsLoaded: true,
    ...overrides,
  };
  const hook = renderHook((props: ListFiltersOptions) => useListFilters(props), {
    initialProps: options,
  });
  return { ...hook, options };
}

beforeEach(() => {
  localStorage.clear();
  resetDiscreetModeForTests();
  window.history.replaceState(null, '', '/wishlists/w1');
});

afterEach(() => {
  cleanup();
  resetDiscreetModeForTests();
});

describe('useListFilters', () => {
  it("hides a member's reservations at render time only in discreet mode", () => {
    act(() => setDiscreetMode(true));
    const { result } = setup();

    expect(result.current.hideReservations).toBe(true);
    expect(result.current.viewItems.find((i) => i._id === 'mine')).toMatchObject({
      status: 'available',
      bookedBy: null,
    });
    // The items as read are untouched, and the chip naming them is gone.
    expect(ITEMS[0].status).toBe('booked');
    expect(result.current.chips.map((c) => c.value)).not.toContain('reserved-by-you');
  });

  it('shows a member their reservations with discreet mode off', () => {
    const { result } = setup();

    expect(result.current.hideReservations).toBe(false);
    expect(result.current.chips.map((c) => c.value)).toContain('reserved-by-you');
  });

  it("never hides an owner's view, whatever discreet mode says", () => {
    act(() => setDiscreetMode(true));
    const { result } = setup({ viewerRole: 'owner', isOwner: true, isMember: false });

    expect(result.current.hideReservations).toBe(false);
    expect(result.current.budgetOffered).toBe(false);
  });

  it('restores a saved sort, and saves only one the viewer picks', () => {
    localStorage.setItem(WISHLIST_SORT_STORAGE_KEY, 'name-asc');
    const { result } = setup();
    expect(result.current.sortBy).toBe('name-asc');

    act(() => result.current.handleSortChange('price-desc'));
    expect(result.current.sortBy).toBe('price-desc');
    expect(localStorage.getItem(WISHLIST_SORT_STORAGE_KEY)).toBe('price-desc');
  });

  it('narrows by budget after the chips have counted', () => {
    const { result } = setup();
    const counts = result.current.chips.map((c) => c.count);

    act(() => result.current.setBudgetText('50'));
    expect(result.current.budgetLimit).toBe(5000);
    expect(result.current.sortedItems.map((i) => i._id)).toEqual(['cheap']);
    expect(result.current.chips.map((c) => c.count)).toEqual(counts);
    expect(result.current.addTile).toBeNull();
  });

  it('clears the search and budget on Show all and on another list', () => {
    const { result, rerender, options } = setup();
    act(() => {
      result.current.setSearchQuery('cheap');
      result.current.setBudgetText('50');
    });

    act(() => result.current.showAllItems());
    expect(result.current.searchQuery).toBe('');
    expect(result.current.budgetText).toBe('');

    act(() => {
      result.current.setSearchQuery('cheap');
      result.current.setBudgetText('50');
    });
    rerender({ ...options, wishlistId: 'w2', list: null });
    expect(result.current.searchQuery).toBe('');
    expect(result.current.budgetText).toBe('');
  });

  it('is not empty until a read has landed', () => {
    expect(setup({ items: [], itemsLoaded: false }).result.current.listIsEmpty).toBe(false);
    cleanup();
    expect(setup({ items: [], itemsLoaded: true }).result.current.listIsEmpty).toBe(true);
  });
});

describe('useListFilters: tag chips (WIS-385)', () => {
  const TAGGED = [
    item('book', 'available', { tags: ['Books'] }),
    item('pan', 'available', { tags: ['Kitchen'] }),
    item('cookbook', 'available', { tags: ['books', 'Kitchen'] }),
    item('plain', 'available'),
    // A member is never sent a draft; one that got through gives no chip.
    item('secret', 'draft', { tags: ['Hidden'] }),
  ];

  it('offers the tags on the items the viewer sees, once each, alphabetical', () => {
    const { result } = setup({ items: TAGGED });
    expect(result.current.tagOptions).toEqual(['Books', 'Kitchen']);
  });

  it('shows items with any picked tag, without moving the status chips’ counts', () => {
    const { result } = setup({ items: TAGGED });
    const allBefore = result.current.chips.find((c) => c.value === 'all')?.count;
    act(() => result.current.toggleTag('Books'));
    expect(result.current.sortedItems.map((i) => i._id).sort()).toEqual(['book', 'cookbook']);
    act(() => result.current.toggleTag('Kitchen'));
    expect(result.current.sortedItems.map((i) => i._id).sort()).toEqual([
      'book',
      'cookbook',
      'pan',
    ]);
    expect(result.current.chips.find((c) => c.value === 'all')?.count).toBe(allBefore);
    act(() => result.current.toggleTag('books'));
    act(() => result.current.toggleTag('Kitchen'));
    expect(result.current.activeTags).toEqual([]);
  });

  it('hides the add tile while a tag is picked, and Show all clears the pick', () => {
    const { result } = setup({
      items: TAGGED,
      viewerRole: 'owner',
      isOwner: true,
      isMember: false,
    });
    expect(result.current.addTile).toBe('add');
    act(() => result.current.toggleTag('Kitchen'));
    expect(result.current.addTile).toBeNull();
    act(() => result.current.showAllItems());
    expect(result.current.activeTags).toEqual([]);
    expect(result.current.addTile).toBe('add');
  });

  it('drops a picked tag once no item carries it any more', () => {
    const { result, rerender, options } = setup({ items: TAGGED });
    act(() => result.current.toggleTag('Kitchen'));
    rerender({ ...options, items: TAGGED.map((i) => ({ ...i, tags: undefined })) });
    expect(result.current.activeTags).toEqual([]);
    expect(result.current.tagOptions).toEqual([]);
    expect(result.current.sortedItems).toHaveLength(4);
  });
});
