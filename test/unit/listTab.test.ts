import { describe, it, expect } from 'vitest';
import { listTabFrom } from '@/lib/hooks/useListTab';

describe('listTabFrom', () => {
  it('reads People and Settings from ?tab=', () => {
    expect(listTabFrom('people')).toBe('people');
    expect(listTabFrom('settings')).toBe('settings');
  });

  it('reads anything else, or nothing, as Items', () => {
    for (const value of [null, undefined, '', 'items', 'Settings', 'members', 'manage']) {
      expect(listTabFrom(value)).toBe('items');
    }
  });
});
