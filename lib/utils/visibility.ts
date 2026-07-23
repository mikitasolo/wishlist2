import { IconName } from '@/components/Icon';

export type Visibility = 'everyone' | 'friends' | 'private';

/** Derive visibility from a wishlist, tolerating legacy docs (isPublic only). */
export function getVisibility(w: { visibility?: Visibility; isPublic?: boolean }): Visibility {
  if (w.visibility) return w.visibility;
  return w.isPublic ? 'everyone' : 'private';
}

export const visibilityMeta: Record<Visibility, { label: string; icon: IconName }> = {
  everyone: { label: 'Public', icon: 'globe' },
  friends: { label: 'Friends', icon: 'users' },
  private: { label: 'Private', icon: 'lock' },
};
