import type { NotificationEmailCopies } from './types';

/**
 * Group gift joins (`group_gift_joined`). To the group gift’s other
 * contributors only (WIS-364). The item and list are free text: in the body
 * only, never the subject.
 */
export const groupGiftJoinedEmail: NotificationEmailCopies<'group_gift_joined'> = {
  group_gift_joined: (_, actor) => ({
    subject: `${actor} joined a group gift you’re in`,
    heading: 'Someone joined your group gift',
    button: 'Open the wishlist',
  }),
};
