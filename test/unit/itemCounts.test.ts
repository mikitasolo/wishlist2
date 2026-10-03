import { describe, it, expect } from 'vitest';
import {
  NO_ITEMS,
  PUBLISHED_ITEM_STATUSES,
  formatItemCount,
  formatOwnerExtras,
  formatOwnerItemSummary,
  isPublishedItem,
  sumItemCounts,
  tallyItems,
} from '@/lib/utils/itemCounts';
import { isCountedOnShareCard } from '@/lib/og/data';

const STATUSES = ['draft', 'available', 'booked', 'completed', 'proposed'] as const;

describe('isPublishedItem', () => {
  it('counts available, booked and completed items, never a draft or a proposal', () => {
    expect(STATUSES.filter(isPublishedItem)).toEqual(['available', 'booked', 'completed']);
    expect([...PUBLISHED_ITEM_STATUSES]).toEqual(['available', 'booked', 'completed']);
  });

  it('is what the share card counts', () => {
    expect(isCountedOnShareCard).toBe(isPublishedItem);
  });
});

describe('tallyItems', () => {
  it('folds booked into the items, and keeps drafts and proposals apart', () => {
    const items = [
      { status: 'available' },
      { status: 'booked' },
      { status: 'booked' },
      { status: 'completed' },
      { status: 'draft' },
      { status: 'proposed' },
      { status: 'proposed' },
    ];
    expect(tallyItems(items)).toEqual({ items: 4, drafts: 1, proposals: 2 });
  });

  it('is all zeros for no items', () => {
    expect(tallyItems([])).toEqual({ items: 0, drafts: 0, proposals: 0 });
  });

  it('never changes the shared zero', () => {
    tallyItems([{ status: 'available' }]);
    expect(NO_ITEMS).toEqual({ items: 0, drafts: 0, proposals: 0 });
  });
});

describe('sumItemCounts', () => {
  it('adds lists together, a missing field or count being zero', () => {
    expect(
      sumItemCounts([
        { items: 3, drafts: 1, proposals: 0 },
        { items: 2 },
        { items: undefined, drafts: 2, proposals: 4 },
        null,
        undefined,
      ])
    ).toEqual({ items: 5, drafts: 3, proposals: 4 });
  });

  it('is all zeros for no lists', () => {
    expect(sumItemCounts([])).toEqual({ items: 0, drafts: 0, proposals: 0 });
  });
});

describe('formatting', () => {
  it('says "item" for one and "items" otherwise', () => {
    expect(formatItemCount(0)).toBe('0 items');
    expect(formatItemCount(1)).toBe('1 item');
    expect(formatItemCount(12)).toBe('12 items');
  });

  it('names the drafts and the proposals to review, leaving out what there is none of', () => {
    expect(formatOwnerExtras({ drafts: 2, proposals: 1 })).toBe('2 drafts · 1 to review');
    expect(formatOwnerExtras({ drafts: 1, proposals: 0 })).toBe('1 draft');
    expect(formatOwnerExtras({ drafts: 0, proposals: 3 })).toBe('3 to review');
    expect(formatOwnerExtras({ drafts: 0, proposals: 0 })).toBeNull();
    expect(formatOwnerExtras({})).toBeNull();
  });

  it('puts the extras after the item count, and shows the count alone without any', () => {
    expect(formatOwnerItemSummary({ items: 11, drafts: 2, proposals: 2 })).toBe(
      '11 items · 2 drafts · 2 to review'
    );
    expect(formatOwnerItemSummary({ items: 1, drafts: 0, proposals: 0 })).toBe('1 item');
  });

  it('never says "booked"', () => {
    const text = formatOwnerItemSummary(tallyItems(STATUSES.map((status) => ({ status }))));
    expect(text).toBe('3 items · 1 draft · 1 to review');
    expect(text).not.toMatch(/book|reserv/i);
  });
});
