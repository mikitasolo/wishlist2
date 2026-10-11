import type { NotificationEmailCopies } from './types';

/**
 * Requests for a wishlist (`wishlist_ask`, WIS-324): to the person asked, never
 * naming any list. Answered from its Activity row (Create a list), not the
 * asker’s profile.
 */
export const wishlistAskEmail: NotificationEmailCopies<'wishlist_ask'> = {
  wishlist_ask: (_, actor) => ({
    subject: `${actor} wants to know what you’d like`,
    heading: 'A friend asked for a wishlist',
    button: 'Open Activity',
    path: '/notifications',
  }),
};
