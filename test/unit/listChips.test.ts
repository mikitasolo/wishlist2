import { describe, it, expect } from 'vitest';
import {
  addTileFor,
  countListChips,
  isDimmedInAll,
  listChipFor,
  listChips,
  LIST_CHIP_LABELS,
  orderListItems,
  type ListChip,
} from '@/lib/utils/listChips';
import { tallyItems } from '@/lib/utils/itemCounts';
import type { ApiItem } from '@/types/api';

const ME = 'me';
const OTHER = 'other';

function item(name: string, fields: Partial<ApiItem> = {}, day = 1): ApiItem {
  return {
    _id: name,
    wishlist: 'w1',
    name,
    status: 'available',
    createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    ...fields,
  } as ApiItem;
}

const names = (items: ApiItem[]) => items.map((i) => i.name);
const labels = (chips: readonly ListChip[]) => chips.map((c) => LIST_CHIP_LABELS[c]);

describe('listChips', () => {
  it('gives an owner All · Drafts · Proposals · Live · Received', () => {
    expect(labels(listChips('owner'))).toEqual(['All', 'Drafts', 'Proposals', 'Live', 'Received']);
  });

  it('gives a member All · Available · Reserved by you · Your proposals', () => {
    expect(labels(listChips('member'))).toEqual([
      'All',
      'Available',
      'Reserved by you',
      'Your proposals',
    ]);
  });

  it('gives a visitor none', () => {
    expect(listChips('visitor')).toEqual([]);
  });

  it('never gives an owner a chip that names a reservation', () => {
    for (const chip of listChips('owner')) {
      expect(LIST_CHIP_LABELS[chip]).not.toMatch(/reserv|book/i);
    }
  });
});

describe('countListChips and orderListItems: an owner', () => {
  // What the items API sends an owner: booked folded into available, with no
  // bookedBy or proposedBy. One that came through booked is tested below.
  const items = [
    item('lamp', {}, 1),
    item('sketch', { status: 'draft' }, 2),
    item('idea', { status: 'proposed' }, 3),
    item('vase', { status: 'completed' }, 4),
    item('kettle', { status: 'available' }, 5),
  ];

  it('counts each chip', () => {
    expect(countListChips(items, 'owner', ME)).toMatchObject({
      all: 5,
      drafts: 1,
      proposals: 1,
      live: 2,
      received: 1,
    });
  });

  // regression: an owner never sees booking, so a booked item is Live, with no
  // count of its own anywhere that would say how much has been reserved.
  it('regression: counts a booked item under Live, and shows it there', () => {
    const booked = [
      item('lamp'),
      item('kettle', { status: 'booked', bookedBy: OTHER }, 2),
      item('mug', { status: 'booked', bookedBy: ME }, 3),
    ];
    const counts = countListChips(booked, 'owner', ME);
    expect(counts).toMatchObject({ all: 3, live: 3, received: 0 });
    expect(counts['reserved-by-you']).toBe(0);
    expect(counts.available).toBe(0);
    expect(names(orderListItems(booked, 'live', 'owner', ME, 'date-asc'))).toEqual([
      'lamp',
      'kettle',
      'mug',
    ]);
    expect(booked.some((i) => isDimmedInAll(i, 'owner', ME))).toBe(false);
  });

  it('counts Live and Received together as the published items "N items" counts', () => {
    const mixed = [...items, item('kettle2', { status: 'booked' }, 6)];
    const counts = countListChips(mixed, 'owner', ME);
    expect(counts.live + counts.received).toBe(tallyItems(mixed).items);
    expect(counts.drafts).toBe(tallyItems(mixed).drafts);
    expect(counts.proposals).toBe(tallyItems(mixed).proposals);
  });

  it('shows each chip its own items', () => {
    const under = (chip: ListChip) => names(orderListItems(items, chip, 'owner', ME, 'date-asc'));
    expect(under('drafts')).toEqual(['sketch']);
    expect(under('proposals')).toEqual(['idea']);
    expect(under('live')).toEqual(['lamp', 'kettle']);
    expect(under('received')).toEqual(['vase']);
  });

  it('puts proposals, then drafts, then live items, then received ones under All', () => {
    expect(names(orderListItems(items, 'all', 'owner', ME, 'date-asc'))).toEqual([
      'idea',
      'sketch',
      'lamp',
      'kettle',
      'vase',
    ]);
  });

  it('applies the sort within each group under All', () => {
    expect(names(orderListItems(items, 'all', 'owner', ME, 'date-desc'))).toEqual([
      'idea',
      'sketch',
      'kettle',
      'lamp',
      'vase',
    ]);
    const twoDrafts = [
      item('b-draft', { status: 'draft' }),
      item('a-draft', { status: 'draft' }),
      item('z-prop', { status: 'proposed' }),
    ];
    expect(names(orderListItems(twoDrafts, 'all', 'owner', ME, 'name-asc'))).toEqual([
      'z-prop',
      'a-draft',
      'b-draft',
    ]);
  });

  it('dims only received items', () => {
    expect(items.filter((i) => isDimmedInAll(i, 'owner', ME)).map((i) => i.name)).toEqual(['vase']);
  });
});

describe('countListChips and orderListItems: a member', () => {
  const items = [
    item('lamp', {}, 1),
    item('scarf', { status: 'booked', bookedBy: ME }, 2),
    item('kettle', { status: 'booked' }, 3),
    item('vase', { status: 'completed' }, 4),
    item('idea', { status: 'proposed', proposedBy: ME }, 5),
    item('mug', {}, 6),
  ];

  it('counts each chip, with what others reserved and received only under All', () => {
    expect(countListChips(items, 'member', ME)).toMatchObject({
      all: 6,
      available: 2,
      'reserved-by-you': 1,
      'your-proposals': 1,
      drafts: 0,
      proposals: 0,
      live: 0,
      received: 0,
    });
  });

  // regression: a member is never told about anyone else's proposal, nor a draft.
  it("regression: never counts or shows someone else's proposal, or a draft", () => {
    const leaked = [
      ...items,
      item('their-idea', { status: 'proposed', proposedBy: OTHER }),
      item('hidden-idea', { status: 'proposed' }),
      item('sketch', { status: 'draft' }),
    ];
    expect(countListChips(leaked, 'member', ME)).toMatchObject({
      all: 6,
      'your-proposals': 1,
    });
    const all = names(orderListItems(leaked, 'all', 'member', ME, 'date-asc'));
    expect(all).not.toContain('their-idea');
    expect(all).not.toContain('hidden-idea');
    expect(all).not.toContain('sketch');
    // A visitor isn't shown any proposal, nor a draft.
    expect(countListChips(leaked, 'visitor', null).all).toBe(5);
  });

  it('shows each chip its own items', () => {
    const under = (chip: ListChip) => names(orderListItems(items, chip, 'member', ME, 'date-asc'));
    expect(under('available')).toEqual(['lamp', 'mug']);
    expect(under('reserved-by-you')).toEqual(['scarf']);
    expect(under('your-proposals')).toEqual(['idea']);
  });

  it('puts available, then reserved by you, their proposals, reserved by someone else, then received under All', () => {
    expect(names(orderListItems(items, 'all', 'member', ME, 'date-asc'))).toEqual([
      'lamp',
      'mug',
      'scarf',
      'idea',
      'kettle',
      'vase',
    ]);
  });

  it('dims what someone else reserved and what has been received', () => {
    expect(items.filter((i) => isDimmedInAll(i, 'member', ME)).map((i) => i.name)).toEqual([
      'kettle',
      'vase',
    ]);
  });

  it('counts a reservation as the viewer’s only when it is theirs', () => {
    expect(countListChips(items, 'member', OTHER)['reserved-by-you']).toBe(0);
    expect(countListChips(items, 'member', null)['reserved-by-you']).toBe(0);
  });
});

describe('a visitor', () => {
  const items = [item('vase', { status: 'completed' }, 1), item('lamp', {}, 2)];

  it('sees every item under All, available first and received dimmed', () => {
    expect(names(orderListItems(items, 'all', 'visitor', null, 'date-asc'))).toEqual([
      'lamp',
      'vase',
    ]);
    expect(isDimmedInAll(items[0], 'visitor', null)).toBe(true);
    expect(isDimmedInAll(items[1], 'visitor', null)).toBe(false);
  });

  it('is shown All for any chip, having none', () => {
    expect(names(orderListItems(items, 'available', 'visitor', null, 'date-asc'))).toEqual([]);
    expect(listChipFor('available', 'visitor')).toBe('all');
  });
});

describe('listChipFor', () => {
  it("takes one of the role's chips", () => {
    expect(listChipFor('live', 'owner')).toBe('live');
    expect(listChipFor('reserved-by-you', 'member')).toBe('reserved-by-you');
  });

  it("falls back to All for anything else, another role's chip included", () => {
    expect(listChipFor(null, 'owner')).toBe('all');
    expect(listChipFor('', 'member')).toBe('all');
    expect(listChipFor('reserved-by-you', 'owner')).toBe('all');
    expect(listChipFor('drafts', 'member')).toBe('all');
    expect(listChipFor('__proto__', 'member')).toBe('all');
  });
});

describe('addTileFor', () => {
  it('gives an owner Add item and a member Propose an item under All, and a visitor nothing', () => {
    expect(addTileFor('owner', 'all', false)).toBe('add');
    expect(addTileFor('member', 'all', false)).toBe('propose');
    expect(addTileFor('visitor', 'all', false)).toBeNull();
  });

  it("keeps a member's under Your proposals, where a proposal is always listed", () => {
    expect(addTileFor('member', 'your-proposals', false)).toBe('propose');
  });

  it('leaves it out under any other chip, which the new item may not be in', () => {
    for (const chip of ['drafts', 'proposals', 'live', 'received'] as ListChip[]) {
      expect(addTileFor('owner', chip, false)).toBeNull();
    }
    for (const chip of ['available', 'reserved-by-you'] as ListChip[]) {
      expect(addTileFor('member', chip, false)).toBeNull();
    }
  });

  it('leaves it out while a search narrows the grid', () => {
    expect(addTileFor('owner', 'all', true)).toBeNull();
    expect(addTileFor('member', 'your-proposals', true)).toBeNull();
  });
});
