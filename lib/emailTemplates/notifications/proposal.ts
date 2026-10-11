import type { NotificationEmailCopies } from './types';

/**
 * Proposals to review (`proposal`): to the list’s owners, never naming who
 * proposed.
 */
export const proposalEmail: NotificationEmailCopies<'proposal'> = {
  proposal: () => ({
    subject: 'A new proposal to review on your wishlist',
    heading: 'A new proposal to review',
    button: 'Review proposals',
  }),
};
