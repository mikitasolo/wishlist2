import type { NotificationEmailCopies } from './types';

/**
 * Group gifts cancelled (`group_gift_cancelled`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftCancelledEmail: NotificationEmailCopies<'group_gift_cancelled'> = {
  group_gift_cancelled: () => ({
    subject: 'A group gift you were in was cancelled',
    heading: 'Your group gift was cancelled',
    button: 'Open the wishlist',
  }),
};
