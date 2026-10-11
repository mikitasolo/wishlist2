import { isolateForText } from '@/lib/utils/emailText';
import {
  escapeHtml,
  getEmailTemplate,
  notificationFooter,
  type EmailContext,
  type RenderedEmail,
} from './layout';

export interface WishlistInvitationDetails {
  /** The invitee's account id, for the unsubscribe link (never shown). */
  recipientId: string;
  /** Free text: escaped in the HTML, and kept out of the subject. */
  wishlistName: string;
  /** `owner` invites (a new co-owner, or a member's promotion) ask them to co-own it. */
  role: 'member' | 'owner';
  /** The inviter's public name for the body: `publicDisplayName`, never from their email. */
  inviterName: string;
  /** The inviter's username, or null. The subject names them by nothing else. */
  inviterUsername: string | null;
}

/**
 * The invite email's subject. It carries nothing a user typed: only the
 * inviter's username, which `USERNAME_REGEX` bounds to lowercase letters,
 * digits and underscores, and the role. Mail clients auto-link URL- and
 * domain-looking text even once it's escaped, and a subject is what an inbox
 * shows before the mail is opened, so a wishlist name like `Claim your gift at
 * https://evil.example/login` there would read as our own call to action
 * (WIS-102). For the same reason an inviter with no username isn't named by
 * their free-text `name`.
 */
function invitationSubject(details: WishlistInvitationDetails): string {
  const inviter = details.inviterUsername ? `@${details.inviterUsername}` : 'Someone';
  return details.role === 'owner'
    ? `${inviter} invited you to co-own a wishlist`
    : `${inviter} invited you to a wishlist`;
}

/**
 * The invitation email (`wishlist_invite`), to `email`, the invitee's own
 * address, which its footer names back to them (and no one else).
 */
export function wishlistInvitationEmail(
  email: string,
  details: WishlistInvitationDetails,
  ctx: EmailContext
): RenderedEmail {
  const { wishlistName, role } = details;
  const inviter = details.inviterUsername ? `@${details.inviterUsername}` : details.inviterName;
  const invitedTo =
    role === 'owner' ? 'invited you to co-own their wishlist' : 'invited you to their wishlist';
  // Straight to their invitations (`/invites`, which opens Activity with them
  // pinned at the top), where they can accept or decline. An invitee
  // who's already signed in (the usual case on a phone) lands there at once; a
  // signed-out one is sent through sign-in and back to it.
  const invitesUrl = `${ctx.siteUrl}/invites`;
  const unsubscribe = ctx.unsubscribe('wishlist_invite');

  const html = getEmailTemplate({
    title: 'Wishlist invitation',
    // Not the list's name: the heading is the first text of the body, which an
    // inbox shows as the preview beside the subject, and it's a line of its own.
    greeting:
      role === 'owner' ? 'You’re invited to co-own a wishlist' : 'You’re invited to a wishlist',
    contentHtml: `
      <p><strong>${escapeHtml(inviter)}</strong> ${invitedTo} <strong>${escapeHtml(wishlistName)}</strong>.</p>
      <p>Review the invitation on your Activity page — you can accept or decline it there.</p>
    `,
    buttonText: 'Review invitation',
    buttonUrl: invitesUrl,
    footerHtml: `Invitation sent to <strong>${escapeHtml(email)}</strong>`,
    unsubscribe: notificationFooter(ctx, unsubscribe),
  });

  return {
    kind: 'wishlist invitation',
    subject: invitationSubject(details),
    html,
    // The name stays inside a sentence that names the inviter, never a line of
    // its own that could pass for our own text.
    text: `Wishlist invitation\n\n${isolateForText(inviter)} ${invitedTo} “${isolateForText(wishlistName)}”.\n\nAccept or decline it on your Activity page: ${invitesUrl}\n\nUnsubscribe from invitation emails: ${unsubscribe.page}`,
    link: invitesUrl,
    unsubscribe,
  };
}
