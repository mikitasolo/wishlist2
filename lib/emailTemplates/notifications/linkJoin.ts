import type { NotificationEmailCopies } from './types';

/**
 * People joining through a link (`link_join`, WIS-337): to the list’s owners.
 * The link’s label is owner-written free text: in the body only.
 */
export const linkJoinEmail: NotificationEmailCopies<'link_join'> = {
  link_join: (_, actor) => ({
    subject: `${actor} joined your wishlist through a link`,
    heading: 'Someone joined your wishlist',
    button: 'See who’s on it',
  }),
};
