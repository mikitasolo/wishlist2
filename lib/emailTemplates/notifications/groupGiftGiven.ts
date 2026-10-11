import type { NotificationEmailCopies } from './types';

/**
 * Group gifts given (`group_gift_given`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftGivenEmail: NotificationEmailCopies<'group_gift_given'> = {
  group_gift_given: () => ({
    subject: 'A group gift you were in was marked as given',
    heading: 'Your group gift was marked as given',
    button: 'Open the wishlist',
  }),
};
