import type { NotificationEmailCopies } from './types';

/**
 * Invitations accepted (`invite_accepted`): to whoever sent the invitation.
 */
export const inviteAcceptedEmail: NotificationEmailCopies<'invite_accepted'> = {
  invite_accepted: (_, actor) => ({
    subject: `${actor} accepted your invitation`,
    heading: 'Your invitation was accepted',
    button: 'Open the wishlist',
  }),
};
