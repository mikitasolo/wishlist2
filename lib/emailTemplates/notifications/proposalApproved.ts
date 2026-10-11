import type { NotificationEmailCopies } from './types';

/**
 * Proposals approved (`proposal_approved`): to whoever proposed the item.
 */
export const proposalApprovedEmail: NotificationEmailCopies<'proposal_approved'> = {
  proposal_approved: () => ({
    subject: 'Your proposed item was accepted',
    heading: 'Your proposed item was accepted',
    button: 'Open the wishlist',
  }),
};
