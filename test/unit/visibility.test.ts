import { describe, it, expect } from 'vitest';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';

describe('getVisibility', () => {
  it('uses the stored visibility', () => {
    expect(getVisibility({ visibility: 'everyone' })).toBe('everyone');
    expect(getVisibility({ visibility: 'friends' })).toBe('friends');
    expect(getVisibility({ visibility: 'private' })).toBe('private');
  });

  // The legacy `isPublic` flag is still written next to `visibility`, but this
  // no longer reads it, so it can't make a list without one look public.
  it('shows a missing visibility as private, whatever isPublic says', () => {
    const withoutVisibility = { visibility: undefined, isPublic: true };
    expect(getVisibility({})).toBe('private');
    expect(getVisibility({ visibility: null })).toBe('private');
    expect(getVisibility(withoutVisibility)).toBe('private');
  });
});

describe('visibilityMeta', () => {
  it('has label + icon for each visibility', () => {
    expect(visibilityMeta.everyone).toEqual({ label: 'Public', icon: 'globe' });
    expect(visibilityMeta.friends.icon).toBe('users');
    expect(visibilityMeta.private.icon).toBe('lock');
  });
});
