import type { NotificationEmailCopies } from './types';

/**
 * Changes to your access (`access_changed`): to the person affected only, never
 * naming who made the change.
 */
export const accessChangedEmail: NotificationEmailCopies<'role_changed' | 'removed_from_wishlist'> =
  {
    role_changed: () => ({
      subject: 'Your role on a wishlist changed',
      heading: 'You’re now a member of a wishlist',
      button: 'Open the wishlist',
    }),
    removed_from_wishlist: () => ({
      subject: 'You were removed from a wishlist',
      heading: 'You were removed from a wishlist',
      button: 'Open Activity',
    }),
  };
