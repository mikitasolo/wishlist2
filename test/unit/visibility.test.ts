import { describe, it, expect } from 'vitest';
import { coverBadge, getVisibility, visibilityMeta } from '@/lib/utils/visibility';

describe('getVisibility', () => {
  it('uses the stored visibility', () => {
    expect(getVisibility({ visibility: 'everyone' })).toBe('everyone');
    expect(getVisibility({ visibility: 'friends' })).toBe('friends');
    expect(getVisibility({ visibility: 'private' })).toBe('private');
  });

  // A list stored before WIS-184 may still carry the legacy `isPublic` flag,
  // which nothing reads, so it can't make a list without a visibility look public.
  it('shows a missing visibility as private, whatever isPublic says', () => {
    const withoutVisibility = { visibility: undefined, isPublic: true };
    expect(getVisibility({})).toBe('private');
    expect(getVisibility({ visibility: null })).toBe('private');
    expect(getVisibility(withoutVisibility)).toBe('private');
  });
});

describe('visibilityMeta', () => {
  it('has label + icon for each visibility', () => {
    expect(visibilityMeta.everyone).toMatchObject({ label: 'Public', icon: 'globe' });
    expect(visibilityMeta.friends).toMatchObject({ label: 'Friends', icon: 'users' });
    expect(visibilityMeta.private).toMatchObject({ label: 'Invite only', icon: 'lock' });
  });

  // regression: a private list was "Only me" in the pickers and "Private" on
  // its pill, though its members and co-owners can open it too (W-28, D1).
  it('names a private list "Invite only", with a helper that says who can open it', () => {
    expect(visibilityMeta.private.label).toBe('Invite only');
    expect(visibilityMeta.private.helper).toBe('Only owners and people you invite can open it.');
    for (const meta of Object.values(visibilityMeta)) {
      expect(meta.label).not.toMatch(/only me|private/i);
      expect(meta.helper).not.toMatch(/only you\b/i);
    }
  });
});

describe('coverBadge', () => {
  it("shows a list's visibility while it isn't archived", () => {
    for (const archived of [false, null, undefined]) {
      expect(coverBadge({ visibility: 'everyone', archived })).toEqual(visibilityMeta.everyone);
      expect(coverBadge({ visibility: 'friends', archived })).toEqual(visibilityMeta.friends);
      expect(coverBadge({ visibility: 'private', archived })).toEqual(visibilityMeta.private);
    }
  });

  // regression: the cover pill came from `visibility` alone, so an archived
  // list, which only its owners can open, still read "Public".
  it('regression: shows an archived list as Archived, whatever its visibility', () => {
    for (const visibility of ['everyone', 'friends', 'private', undefined] as const) {
      expect(coverBadge({ visibility, archived: true })).toEqual({
        label: 'Archived',
        icon: 'archive',
      });
    }
  });
});
