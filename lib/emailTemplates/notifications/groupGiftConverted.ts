import type { NotificationEmailCopies } from './types';

/**
 * Group gifts made solo (`group_gift_converted`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftConvertedEmail: NotificationEmailCopies<'group_gift_converted'> = {
  group_gift_converted: () => ({
    subject: 'A group gift you were in is now a solo reservation',
    heading: 'Your group gift is now a solo reservation',
    button: 'Open the wishlist',
  }),
};
