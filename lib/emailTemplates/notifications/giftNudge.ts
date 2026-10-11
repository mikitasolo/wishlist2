import type { NotificationEmailCopies } from './types';

/**
 * Gifts to mark as given (`gift_nudge`, WIS-384): to whoever holds a
 * reservation on the list only. The list is free text: in the body only. Names
 * no item or count.
 */
export const giftNudgeEmail: NotificationEmailCopies<'gift_nudge'> = {
  gift_nudge: () => ({
    subject: 'Did you give what you reserved?',
    heading: 'Don’t forget to mark it as given',
    button: 'Open Reserved',
  }),
};
