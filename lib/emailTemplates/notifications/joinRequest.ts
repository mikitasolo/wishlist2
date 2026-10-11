import type { NotificationEmailCopies } from './types';

/**
 * Requests to join (`join_request`): to the list’s owners, naming who asked.
 */
export const joinRequestEmail: NotificationEmailCopies<'join_request'> = {
  join_request: (_, actor) => ({
    subject: `${actor} asked to join your wishlist`,
    heading: 'A request to join your wishlist',
    button: 'Review the request',
  }),
};
