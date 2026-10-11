import type { OccasionKind } from '@/lib/utils/occasion';
import type { NotificationEmailCopies } from './types';

const OCCASION_SUBJECT_KIND: Record<OccasionKind, string> = {
  birthday: 'A birthday',
  holiday: 'A holiday',
  wedding: 'A wedding',
  other: 'An occasion',
};

/**
 * Occasion reminders (`occasion_reminder`): to a list's members only, a week
 * ahead. The subject names the kind of occasion, never the list.
 */
export const occasionReminderEmail: NotificationEmailCopies<'occasion_reminder'> = {
  occasion_reminder: (details) => {
    const kind = OCCASION_SUBJECT_KIND[details.occasionKind ?? 'other'] ?? 'An occasion';
    return {
      subject: `${kind} is coming up on a wishlist you’re on`,
      heading: `${kind} is coming up`,
      button: 'Open the wishlist',
    };
  },
};
