import type { NotificationEmailCopies } from './types';

/**
 * Gifts you’ve reserved (`gift_reminder`, WIS-384): to whoever holds a
 * reservation on the list only. The list is free text: in the body only. Names
 * no item or count.
 */
export const giftReminderEmail: NotificationEmailCopies<'gift_reminder'> = {
  gift_reminder: () => ({
    subject: 'A reminder about what you’ve reserved',
    heading: 'Don’t forget what you reserved',
    button: 'Open Reserved',
  }),
};
