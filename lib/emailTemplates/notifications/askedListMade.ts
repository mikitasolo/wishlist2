import type { NotificationEmailCopies } from './types';

/**
 * Wishlists you asked for (`asked_list_made`, WIS-324): to an asker who can
 * open the new list.
 */
export const askedListMadeEmail: NotificationEmailCopies<'asked_list_made'> = {
  asked_list_made: (_, actor) => ({
    subject: `${actor} made a wishlist you asked for`,
    heading: 'A wishlist you asked for',
    button: 'Open the wishlist',
  }),
};
