import { IconName } from '@/components/Icon';

export type Visibility = 'everyone' | 'friends' | 'private';

/**
 * A wishlist's visibility, for display. Every stored list has one (the schema
 * requires it), so this only fails closed on a value that's missing anyway, say
 * from a read that didn't select it: that shows as private, never as public.
 */
export function getVisibility(w: { visibility?: Visibility | null }): Visibility {
  return w.visibility ?? 'private';
}

/**
 * Each tier's name, icon and one-line helper, the same in the pickers (create
 * and settings) and on the pill. A `private` list reads "Invite only": its
 * members and co-owners can open it too, so it isn't its owner's alone.
 */
export const visibilityMeta: Record<Visibility, { label: string; icon: IconName; helper: string }> =
  {
    everyone: { label: 'Public', icon: 'globe', helper: 'Anyone can open it.' },
    friends: {
      label: 'Friends',
      icon: 'users',
      helper: 'Owners, their friends (mutual follows) and people you invite can open it.',
    },
    private: {
      label: 'Invite only',
      icon: 'lock',
      helper: 'Only owners and people you invite can open it.',
    },
  };

/** The three tiers, widest first, as the visibility picker's options (a `SegmentedControl`). */
export const VISIBILITY_OPTIONS = (['everyone', 'friends', 'private'] as const).map((value) => ({
  value,
  label: visibilityMeta[value].label,
  icon: visibilityMeta[value].icon,
}));

/**
 * The pill on a list's cover: its visibility, unless it's archived. An archived
 * list is owner-only whatever its visibility says (everyone else gets the
 * not-found answer), so calling it Public there would tell its owner that
 * anyone can still open it.
 */
export function coverBadge(w: { visibility?: Visibility | null; archived?: boolean | null }): {
  label: string;
  icon: IconName;
} {
  return w.archived ? { label: 'Archived', icon: 'archive' } : visibilityMeta[getVisibility(w)];
}
