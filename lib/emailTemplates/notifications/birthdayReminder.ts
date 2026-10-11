import type { NotificationEmailCopies } from './types';

/**
 * Friends’ birthdays (`birthday_reminder`, WIS-345): about a person, never a
 * list.
 */
export const birthdayReminderEmail: NotificationEmailCopies<'birthday_reminder'> = {
  birthday_reminder: (_, actor) => ({
    subject: `${actor}’s birthday is coming up`,
    heading: 'A friend’s birthday is coming up',
    button: 'Open their profile',
  }),
};
