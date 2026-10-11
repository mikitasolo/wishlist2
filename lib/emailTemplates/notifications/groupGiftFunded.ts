import type { NotificationEmailCopies } from './types';

/**
 * Group gifts fully funded (`group_gift_funded`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftFundedEmail: NotificationEmailCopies<'group_gift_funded'> = {
  group_gift_funded: () => ({
    subject: 'A group gift you’re in is fully funded',
    heading: 'Your group gift is fully funded',
    button: 'Open the wishlist',
  }),
};
