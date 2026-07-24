import { describe, it, expect } from 'vitest';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';

describe('getVisibility', () => {
  it('uses the explicit visibility when present', () => {
    expect(getVisibility({ visibility: 'friends' })).toBe('friends');
    expect(getVisibility({ visibility: 'private' })).toBe('private');
  });

  it('falls back to legacy isPublic', () => {
    expect(getVisibility({ isPublic: true })).toBe('everyone');
    expect(getVisibility({ isPublic: false })).toBe('private');
    expect(getVisibility({})).toBe('private');
  });
});

describe('visibilityMeta', () => {
  it('has label + icon for each visibility', () => {
    expect(visibilityMeta.everyone).toEqual({ label: 'Public', icon: 'globe' });
    expect(visibilityMeta.friends.icon).toBe('users');
    expect(visibilityMeta.private.icon).toBe('lock');
  });
});
