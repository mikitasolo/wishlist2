import { describe, it, expect } from 'vitest';
import { searchWishlists } from '@/lib/utils/wishlistSearch';

const lists = [
  { name: 'Birthday 2026', ownerUsername: 'ann' },
  { name: 'Christmas', ownerUsername: 'bob' },
  { name: null, ownerUsername: 'cy' },
];

describe('searchWishlists', () => {
  it('returns every list for an empty or blank query', () => {
    expect(searchWishlists(lists, '')).toBe(lists);
    expect(searchWishlists(lists, '   ')).toBe(lists);
  });
  it('matches the name, case-insensitively', () => {
    expect(searchWishlists(lists, 'BIRTH').map((l) => l.name)).toEqual(['Birthday 2026']);
  });
  it('matches extra text only when the caller gives it', () => {
    expect(searchWishlists(lists, 'bob')).toEqual([]);
    expect(searchWishlists(lists, 'bob', (l) => l.ownerUsername)).toEqual([lists[1]]);
  });
  it('tolerates a missing name', () => {
    expect(searchWishlists(lists, 'cy')).toEqual([]);
  });
});
