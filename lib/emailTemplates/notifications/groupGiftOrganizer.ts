import type { NotificationEmailCopies } from './types';

/**
 * Group gifts handed to you (`group_gift_organizer`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftOrganizerEmail: NotificationEmailCopies<'group_gift_organizer'> = {
  group_gift_organizer: () => ({
    subject: 'You’re now organizing a group gift',
    heading: 'You’re now the organizer',
    button: 'Open the wishlist',
  }),
};
