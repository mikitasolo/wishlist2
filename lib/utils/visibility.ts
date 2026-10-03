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

export const visibilityMeta: Record<Visibility, { label: string; icon: IconName }> = {
  everyone: { label: 'Public', icon: 'globe' },
  friends: { label: 'Friends', icon: 'users' },
  private: { label: 'Private', icon: 'lock' },
};

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
