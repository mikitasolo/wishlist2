import { describe, it, expect } from 'vitest';
import { matchesReservedSearch } from '@/lib/utils/reservationSearch';

const row = { itemName: 'Lego Set', listName: 'Birthday 2026', username: 'alice' };

describe('matchesReservedSearch', () => {
  it('matches everything for a blank query', () => {
    expect(matchesReservedSearch(row, '')).toBe(true);
    expect(matchesReservedSearch(row, '   ')).toBe(true);
  });

  it('matches item, list and person, case-insensitively, by substring', () => {
    expect(matchesReservedSearch(row, 'lego')).toBe(true);
    expect(matchesReservedSearch(row, 'BIRTH')).toBe(true);
    expect(matchesReservedSearch(row, 'lic')).toBe(true);
    expect(matchesReservedSearch(row, 'kettle')).toBe(false);
  });

  it('takes a leading @ for a person, but not for an item or list', () => {
    expect(matchesReservedSearch(row, '@alice')).toBe(true);
    expect(matchesReservedSearch(row, '@lego')).toBe(false);
    expect(
      matchesReservedSearch({ itemName: 'x', listName: '@home', username: null }, '@home')
    ).toBe(true);
  });

  it('a bare @ matches no person, and rows with no list or person still search by item', () => {
    expect(matchesReservedSearch({ itemName: 'Mug', listName: null, username: 'bob' }, '@')).toBe(
      false
    );
    expect(matchesReservedSearch({ itemName: 'Mug', listName: null, username: null }, 'mug')).toBe(
      true
    );
  });

  // regression: only the handle is searched; an email-looking query matches nothing.
  it('never matches an email', () => {
    expect(matchesReservedSearch(row, 'alice@example.com')).toBe(false);
  });
});
