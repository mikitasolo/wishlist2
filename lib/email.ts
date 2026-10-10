import nodemailer from 'nodemailer';
import { getEnvVars } from './env';
import { EMAIL_LOGO_PNG_BASE64 } from './emailLogo';
import { isolateForText } from './utils/emailText';
import { unsubscribeUrls } from './utils/unsubscribe';
import {
  NOTIFICATION_EVENTS,
  notificationEventOf,
  type NotificationEvent,
} from './utils/notificationPrefs';
import {
  notificationLink,
  notificationParts,
  type GiftReminderNotificationType,
  type GroupGiftNotificationType,
  type NotificationView,
} from './utils/notifications';
import type { OccasionKind } from './utils/occasion';
import {
  BIRTHDAY_NUDGE_DETAIL,
  BIRTHDAY_NUDGE_EMAIL_PATH,
  birthdayNudgeTitle,
} from './utils/birthdayNudge';

// Get validated environment variables
const env = getEnvVars();

// Create SMTP transporter, in `smtp` mode only: the `console` transport has no
// SMTP config and never dials a server.
const smtpTransporter =
  env.EMAIL_TRANSPORT === 'smtp'
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: parseInt(env.SMTP_PORT),
        secure: env.SMTP_SECURE === 'true', // true for 465, false for other ports
        // Bounded, as notification emails are sent inside the request that
        // caused them: a slow SMTP server must fail a send in seconds, not
        // hold the action for nodemailer's minutes-long defaults.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASSWORD,
        },
      })
    : null;

// The brand logo. Email clients render SVG poorly and block remote images by
// default, so it goes in as an inline (CID) PNG attachment, which renders
// everywhere without a network fetch. The PNG is pre-rendered from
// app/icon.svg (scripts/generate-email-logo.mjs), so sending an email needs no
// sharp at all: NextAuth and the sign-in form's server action import this
// file, and a sharp that couldn't load there (WIS-156) once took sign-in down.
const LOGO_CID = 'wishlist-logo';
const LOGO_PNG = Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64');

interface OutgoingEmail {
  /** What kind of email this is, for log lines. Never the recipient. */
  kind: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The link the email exists to deliver (magic link, invitations page, …). */
  link: string;
  /**
   * A notification email's one-click unsubscribe (`notificationUnsubscribe`):
   * sent as `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058), so a mail
   * client's own Unsubscribe turns off just this email. Never on a magic link.
   */
  unsubscribe?: Unsubscribe;
}

interface Unsubscribe {
  /** The footer link: a page with one button (`/unsubscribe`). */
  page: string;
  /** The header's target, which a mail client POSTs to (`/api/unsubscribe`). */
  oneClick: string;
}

/**
 * The unsubscribe links for a notification email about `event` to the account
 * `recipientId`: they turn off that event's email, and only for that account.
 */
function notificationUnsubscribe(recipientId: string, event: NotificationEvent): Unsubscribe {
  return unsubscribeUrls(env.NEXTAUTH_URL, { userId: recipientId, event });
}

/** The headers that make a mail client offer one-click unsubscribe (RFC 2369, RFC 8058). */
export function unsubscribeHeaders(unsubscribe: Unsubscribe): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribe.oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * A loggable summary of a failed SMTP send. Nodemailer's error messages and
 * fields can carry the recipient ("Invalid recipient …", `rejected`, the
 * server's `response`), so keep only the diagnostic codes.
 */
function describeSendError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const { code, responseCode, command } = error as Error & Record<string, unknown>;
  return [
    error.name,
    typeof code === 'string' && `code=${code}`,
    typeof responseCode === 'number' && `responseCode=${responseCode}`,
    typeof command === 'string' && `command=${command}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The one place an email leaves the app. Every sender goes through here, so
 * none of them can bypass the configured `EMAIL_TRANSPORT`.
 *
 * - `console`: print the recipient, subject and link to the server log and send
 *   nothing. For local dev; `lib/env` refuses it on Vercel Preview and Production.
 * - `smtp`: send it. Never log the recipient or the link: a magic link in a log
 *   is a working sign-in credential. That holds on failure too, so the error is
 *   logged and rethrown in a form that carries neither (callers log it again).
 */
async function deliver(email: OutgoingEmail): Promise<void> {
  if (!smtpTransporter) {
    // EMAIL_TRANSPORT=console (the transporter only exists in smtp mode).
    console.log(
      `[email] EMAIL_TRANSPORT=console: ${email.kind} email printed, not sent\n` +
        `  To:      ${email.to}\n` +
        `  Subject: ${email.subject}\n` +
        `  Link:    ${email.link}`
    );
    return;
  }

  try {
    await smtpTransporter.sendMail({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.unsubscribe ? { headers: unsubscribeHeaders(email.unsubscribe) } : {}),
      attachments: [{ filename: 'logo.png', content: LOGO_PNG, cid: LOGO_CID }],
    });
    console.log(`Sent ${email.kind} email`);
  } catch (error) {
    const reason = describeSendError(error);
    console.error(`Error sending ${email.kind} email: ${reason}`);
    throw new Error(`Could not send ${email.kind} email (${reason})`);
  }
}

/**
 * Escape a value for HTML text or a quoted attribute. Every user-controlled value
 * (a wishlist name, a display name, an address, a link carrying user input) must
 * pass through here before it goes into an email's HTML: a wishlist name is free
 * text, and unescaped it could put a live link or image in a mail sent from our
 * domain. Plain-text parts take the raw value. Subjects take no free text at all:
 * escaping can't stop a mail client auto-linking URL-looking text, and the
 * subject is what an inbox shows unopened (see `invitationSubject`). A raw value
 * has to be one line, or it adds lines of its own to a text part. The wishlist
 * name's schema (`lib/validations.ts`) refuses line breaks and control
 * characters on create and rename, and the bidi overrides and isolates that
 * would reorder the rest of the line. Rows saved before it did weren't migrated,
 * so every free-text value in a text part goes through `isolateForText`.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Generate beautiful HTML email template.
 *
 * `title`, `greeting`, `buttonText`, `buttonUrl` and `linkUrl` are plain text and
 * escaped here. `contentHtml` and `footerHtml` are HTML fragments inserted as-is,
 * so the caller escapes every value it interpolates into them with `escapeHtml`.
 * Escaping doesn't vet a URL's scheme: `buttonUrl` / `linkUrl` must be links we
 * build (the magic link, our own pages), never a user-supplied URL.
 */
function getEmailTemplate(options: {
  title: string;
  greeting: string;
  contentHtml: string;
  buttonText?: string;
  buttonUrl?: string;
  footerHtml?: string;
  showLinkFallback?: boolean;
  linkUrl?: string;
  /**
   * A notification email's unsubscribe page (`Unsubscribe.page`): the footer
   * then offers it and Settings, in place of "If you didn’t request this".
   */
  unsubscribeUrl?: string;
}) {
  const siteTitle = 'Wishlist';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="color-scheme" content="light dark">
        <meta name="supported-color-schemes" content="light dark">
        <title>${escapeHtml(options.title)}</title>
        <style>
          :root { color-scheme: light dark; supported-color-schemes: light dark; }
          body, table, td, p, a, li, blockquote {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
          body {
            margin: 0;
            padding: 0;
            width: 100% !important;
            background-color: #f2f2f5;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          .email-wrapper { width: 100%; background-color: #f2f2f5; padding: 40px 0; }
          .email-container {
            max-width: 560px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #e3e3e8;
            border-radius: 18px;
            overflow: hidden;
          }
          .email-header {
            background-color: #5e5ce6;
            background-image: linear-gradient(135deg, #5e5ce6 0%, #8a5cff 55%, #ff5c8a 100%);
            padding: 36px 30px;
            text-align: center;
          }
          .brand-badge {
            display: inline-block;
            width: 48px;
            height: 48px;
            border-radius: 14px;
            margin-bottom: 12px;
          }
          .brand-word {
            margin: 0;
            color: #ffffff;
            font-size: 19px;
            font-weight: 600;
            letter-spacing: -0.3px;
          }
          .email-body { padding: 36px 32px; line-height: 1.6; font-size: 16px; }
          .email-body h2 {
            margin: 0 0 16px 0;
            color: #1d1d1f;
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.6px;
            line-height: 1.25;
          }
          .email-body p { margin: 0 0 16px 0; color: #6e6e73; }
          .email-body p:last-child { margin-bottom: 0; }
          .email-body strong { color: #1d1d1f; font-weight: 600; }
          .button-container { text-align: center; margin: 30px 0 8px; }
          .email-button {
            display: inline-block;
            padding: 15px 32px;
            background-color: #5e5ce6;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 999px;
            font-weight: 600;
            font-size: 15px;
          }
          .link-fallback {
            margin-top: 22px;
            padding: 14px 16px;
            background-color: #f2f2f5;
            border: 1px solid #e3e3e8;
            border-radius: 12px;
          }
          .link-fallback p { margin: 0 0 6px 0; font-size: 13px; color: #6e6e73; }
          .link-fallback a { color: #3a38a6; word-break: break-all; text-decoration: none; font-size: 13px; }
          .email-footer { padding: 26px 32px; background-color: #f2f2f5; border-top: 1px solid #e3e3e8; text-align: center; }
          .email-footer p { margin: 0 0 6px 0; font-size: 12.5px; color: #6e6e73; line-height: 1.5; }
          .email-footer p:last-child { margin-bottom: 0; }
          .email-footer a { color: #3a38a6; text-decoration: underline; }

          @media only screen and (max-width: 600px) {
            .email-wrapper { padding: 20px 0; }
            .email-container { border-radius: 0; border-left: 0; border-right: 0; }
            .email-body { padding: 28px 22px; font-size: 15px; }
            .email-body h2 { font-size: 21px; }
          }

          /* Dark mode — keeps contrast readable in dark mail clients (Apple Mail etc.) */
          @media (prefers-color-scheme: dark) {
            body, .email-wrapper { background-color: #0e0e12 !important; }
            .email-container { background-color: #1b1b20 !important; border-color: #303036 !important; }
            .email-body h2 { color: #f5f5f7 !important; }
            .email-body p { color: #a7a7ad !important; }
            .email-body strong { color: #f5f5f7 !important; }
            .link-fallback { background-color: #26262c !important; border-color: #303036 !important; }
            .link-fallback p { color: #a7a7ad !important; }
            .link-fallback a { color: #a3a1ff !important; }
            .email-footer { background-color: #141418 !important; border-color: #303036 !important; }
            .email-footer p { color: #a7a7ad !important; }
            .email-footer a { color: #a3a1ff !important; }
          }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <img src="cid:wishlist-logo" width="48" height="48" alt="Wishlist" class="brand-badge" />
              <p class="brand-word">${siteTitle}</p>
            </div>

            <div class="email-body">
              <h2>${escapeHtml(options.greeting)}</h2>
              ${options.contentHtml}

              ${
                options.buttonText && options.buttonUrl
                  ? `<div class="button-container">
                  <a href="${escapeHtml(options.buttonUrl)}" class="email-button">${escapeHtml(options.buttonText)}</a>
                </div>`
                  : ''
              }

              ${
                options.showLinkFallback && options.linkUrl
                  ? `<div class="link-fallback">
                  <p>Or paste this link into your browser:</p>
                  <a href="${escapeHtml(options.linkUrl)}">${escapeHtml(options.linkUrl)}</a>
                </div>`
                  : ''
              }
            </div>

            <div class="email-footer">
              ${options.footerHtml ? `<p>${options.footerHtml}</p>` : ''}
              ${
                options.unsubscribeUrl
                  ? `<p>Sent by ${siteTitle} · <a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe from these emails</a> · <a href="${escapeHtml(`${env.NEXTAUTH_URL}/settings#notifications`)}">Notification settings</a></p>`
                  : `<p>Sent by ${siteTitle} · If you didn’t request this, you can safely ignore it.</p>`
              }
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendMagicLinkEmail(email: string, magicLink: string) {
  const siteTitle = 'Wishlist';

  const html = getEmailTemplate({
    title: 'Sign in',
    greeting: 'Sign in to Wishlist',
    contentHtml: `
      <p>Tap the button below to securely sign in — no password needed. This link signs you straight in and expires in 24 hours.</p>
    `,
    buttonText: 'Sign in',
    buttonUrl: magicLink,
    showLinkFallback: true,
    linkUrl: magicLink,
  });

  await deliver({
    kind: 'magic link',
    to: email,
    subject: `Sign in to ${siteTitle}`,
    html,
    text: `Sign in to ${siteTitle}\n\nHello!\n\nClick the link below to sign in to your ${siteTitle} account:\n${magicLink}\n\nThis link will expire in 24 hours.\n\nIf you didn't request this email, you can safely ignore it.`,
    link: magicLink,
  });
}

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

export async function sendWishlistInvitationEmail(
  email: string,
  details: WishlistInvitationDetails
) {
  const { wishlistName, role } = details;
  const inviter = details.inviterUsername ? `@${details.inviterUsername}` : details.inviterName;
  const invitedTo =
    role === 'owner' ? 'invited you to co-own their wishlist' : 'invited you to their wishlist';
  // Straight to their invitations (`/invites`, which opens Activity with them
  // pinned at the top), where they can accept or decline. An invitee
  // who's already signed in (the usual case on a phone) lands there at once; a
  // signed-out one is sent through sign-in and back to it.
  const invitesUrl = `${env.NEXTAUTH_URL}/invites`;
  const unsubscribe = notificationUnsubscribe(details.recipientId, 'wishlist_invite');

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
    unsubscribeUrl: unsubscribe.page,
  });

  await deliver({
    kind: 'wishlist invitation',
    to: email,
    subject: invitationSubject(details),
    html,
    // The name stays inside a sentence that names the inviter, never a line of
    // its own that could pass for our own text.
    text: `Wishlist invitation\n\n${isolateForText(inviter)} ${invitedTo} “${isolateForText(wishlistName)}”.\n\nAccept or decline it on your Activity page: ${invitesUrl}\n\nUnsubscribe from invitation emails: ${unsubscribe.page}`,
    link: invitesUrl,
    unsubscribe,
  });
}

/** The notification types that send an email of their own through `sendNotificationEmail`. */
export type EmailedNotificationType =
  | 'join_request'
  | 'link_join'
  | 'proposal'
  | 'role_changed'
  | 'removed_from_wishlist'
  | 'invite_accepted'
  | 'proposal_approved'
  | 'occasion_reminder'
  | 'birthday_reminder'
  | 'wishlist_ask'
  | 'asked_list_made'
  | GroupGiftNotificationType
  | GiftReminderNotificationType;

export interface NotificationEmailDetails {
  /** The recipient's account id, for the unsubscribe link (never shown). */
  recipientId: string;
  type: EmailedNotificationType;
  /**
   * Whoever did it, by username only, on the types whose in-app row names
   * them (`join_request`, `invite_accepted`, `link_join`), and whose birthday
   * it is on a `birthday_reminder`. Ignored on every other type.
   */
  actorUsername?: string | null;
  /** The list it's about: null on a `birthday_reminder` or `wishlist_ask`, which are about a person. */
  wishlistId: string | null;
  /** Free text: escaped in the HTML, isolated in the text part, never in the subject. */
  wishlistName: string | null;
  wishlistSlug?: string | null;
  /** `proposal_approved` and the group gift types: the item, as the in-app row names it. Free text. */
  itemName?: string | null;
  /** `occasion_reminder`, `gift_reminder` and `gift_nudge`. */
  occasionKind?: OccasionKind | null;
  /** Those three and `birthday_reminder`: the day it's about. */
  occasionDate?: string | null;
  /** `link_join` only: the share link's label, as its in-app row names it. Free text. */
  linkLabel?: string | null;
}

/** The types whose email names who did it: the same ones whose in-app row does. */
const NAMES_ACTOR: ReadonlySet<EmailedNotificationType> = new Set([
  'join_request',
  'invite_accepted',
  'link_join',
  'birthday_reminder',
  'wishlist_ask',
  'asked_list_made',
  'group_gift_joined',
]);

const OCCASION_SUBJECT_KIND: Record<OccasionKind, string> = {
  birthday: 'A birthday',
  holiday: 'A holiday',
  wedding: 'A wedding',
  other: 'An occasion',
};

/**
 * Subject, heading and button of a notification email. None carries free
 * text: only the actor's username, which `USERNAME_REGEX` bounds (see
 * `invitationSubject`), and fixed words.
 */
function notificationEmailCopy(
  details: NotificationEmailDetails,
  actor: string
): { subject: string; heading: string; button: string; path?: string } {
  switch (details.type) {
    case 'join_request':
      return {
        subject: `${actor} asked to join your wishlist`,
        heading: 'A request to join your wishlist',
        button: 'Review the request',
      };
    // The link's label is owner-written free text: in the body only.
    case 'link_join':
      return {
        subject: `${actor} joined your wishlist through a link`,
        heading: 'Someone joined your wishlist',
        button: 'See who’s on it',
      };
    case 'proposal':
      return {
        subject: 'A new proposal to review on your wishlist',
        heading: 'A new proposal to review',
        button: 'Review proposals',
      };
    case 'role_changed':
      return {
        subject: 'Your role on a wishlist changed',
        heading: 'You’re now a member of a wishlist',
        button: 'Open the wishlist',
      };
    case 'removed_from_wishlist':
      return {
        subject: 'You were removed from a wishlist',
        heading: 'You were removed from a wishlist',
        button: 'Open Activity',
      };
    case 'invite_accepted':
      return {
        subject: `${actor} accepted your invitation`,
        heading: 'Your invitation was accepted',
        button: 'Open the wishlist',
      };
    case 'proposal_approved':
      return {
        subject: 'Your proposed item was accepted',
        heading: 'Your proposed item was accepted',
        button: 'Open the wishlist',
      };
    case 'occasion_reminder': {
      const kind = OCCASION_SUBJECT_KIND[details.occasionKind ?? 'other'] ?? 'An occasion';
      return {
        subject: `${kind} is coming up on a wishlist you’re on`,
        heading: `${kind} is coming up`,
        button: 'Open the wishlist',
      };
    }
    // About a person, never a list (WIS-345).
    case 'birthday_reminder':
      return {
        subject: `${actor}’s birthday is coming up`,
        heading: 'A friend’s birthday is coming up',
        button: 'Open their profile',
      };
    // WIS-324: to the person asked, never naming any list.
    case 'wishlist_ask':
      return {
        subject: `${actor} wants to know what you’d like`,
        heading: 'A friend asked for a wishlist',
        button: 'Open Activity',
        // Answered from its Activity row (Create a list), not the asker's profile.
        path: '/notifications',
      };
    case 'asked_list_made':
      return {
        subject: `${actor} made a wishlist you asked for`,
        heading: 'A wishlist you asked for',
        button: 'Open the wishlist',
      };
    // WIS-364: to contributors only. The item and list are free text: in the
    // body only, never the subject.
    case 'group_gift_joined':
      return {
        subject: `${actor} joined a group gift you’re in`,
        heading: 'Someone joined your group gift',
        button: 'Open the wishlist',
      };
    case 'group_gift_funded':
      return {
        subject: 'A group gift you’re in is fully funded',
        heading: 'Your group gift is fully funded',
        button: 'Open the wishlist',
      };
    case 'group_gift_organizer':
      return {
        subject: 'You’re now organizing a group gift',
        heading: 'You’re now the organizer',
        button: 'Open the wishlist',
      };
    case 'group_gift_cancelled':
      return {
        subject: 'A group gift you were in was cancelled',
        heading: 'Your group gift was cancelled',
        button: 'Open the wishlist',
      };
    case 'group_gift_converted':
      return {
        subject: 'A group gift you were in is now a solo reservation',
        heading: 'Your group gift is now a solo reservation',
        button: 'Open the wishlist',
      };
    case 'group_gift_given':
      return {
        subject: 'A group gift you were in was marked as given',
        heading: 'Your group gift was marked as given',
        button: 'Open the wishlist',
      };
    // WIS-384: to whoever holds a reservation on the list only. The list is
    // free text: in the body only. Neither names an item or a count.
    case 'gift_reminder':
      return {
        subject: 'A reminder about what you’ve reserved',
        heading: 'Don’t forget what you reserved',
        button: 'Open Reserved',
      };
    case 'gift_nudge':
      return {
        subject: 'Did you give what you reserved?',
        heading: 'Don’t forget to mark it as given',
        button: 'Open Reserved',
      };
  }
}

/**
 * A notification email (WIS-321): the in-app row's own line, built by the same
 * `notificationParts` from the same fields, so an email never says more than
 * the notification does (a proposal stays anonymous, a role change never names
 * who made it, nothing mentions bookings). It links where the row links, and
 * to Activity where the row links nowhere (a removal) or where its copy says
 * so (an ask for a wishlist, answered from its row there). Every one carries the
 * unsubscribe link and headers for its event.
 */
export async function sendNotificationEmail(email: string, details: NotificationEmailDetails) {
  const actorUsername = NAMES_ACTOR.has(details.type) ? (details.actorUsername ?? null) : null;
  const view = (overrides: Partial<NotificationView>): NotificationView => ({
    _id: '',
    type: details.type,
    actorUsername,
    count: 1,
    wishlistName: details.wishlistName,
    wishlistSlug: details.wishlistSlug ?? null,
    wishlistId: details.wishlistId,
    itemName: details.itemName ?? null,
    occasionKind: details.occasionKind ?? null,
    occasionDate: details.occasionDate ?? null,
    linkLabel: details.type === 'link_join' ? (details.linkLabel ?? null) : null,
    read: false,
    createdAt: '',
    ...overrides,
  });

  const htmlLine = notificationParts(view({}))
    .map((part) =>
      typeof part === 'string' ? escapeHtml(part) : `<strong>${escapeHtml(part.listName)}</strong>`
    )
    .join('');
  // The text part takes raw values, so each free-text one is isolated first.
  const textLine = notificationParts(
    view({
      wishlistName: details.wishlistName ? isolateForText(details.wishlistName) : null,
      itemName: details.itemName ? isolateForText(details.itemName) : null,
      linkLabel:
        details.type === 'link_join' && details.linkLabel
          ? isolateForText(details.linkLabel)
          : null,
    })
  )
    .map((part) => (typeof part === 'string' ? part : `“${part.listName}”`))
    .join('');

  const copy = notificationEmailCopy(details, actorUsername ? `@${actorUsername}` : 'Someone');
  const path = copy.path ?? notificationLink(view({})) ?? '/notifications';
  const url = `${env.NEXTAUTH_URL}${path}`;
  const event = notificationEventOf(details.type);
  const unsubscribe = notificationUnsubscribe(details.recipientId, event);
  const topic = NOTIFICATION_EVENTS[event].label.toLowerCase();

  const html = getEmailTemplate({
    title: copy.heading,
    greeting: copy.heading,
    contentHtml: `<p>${htmlLine}.</p>`,
    buttonText: copy.button,
    buttonUrl: url,
    unsubscribeUrl: unsubscribe.page,
  });

  await deliver({
    kind: `${details.type} notification`,
    to: email,
    subject: copy.subject,
    html,
    text: `${copy.heading}\n\n${textLine}.\n\n${copy.button}: ${url}\n\nUnsubscribe from ${topic} emails: ${unsubscribe.page}`,
    link: url,
    unsubscribe,
  });
}

export interface BirthdayNudgeEmailDetails {
  /** The recipient's account id, for the unsubscribe link (never shown). */
  recipientId: string;
  /** Days until their birthday, for the heading ("in 3 weeks"). */
  days: number;
}

/**
 * The nudge to make a list before your own birthday (WIS-344), sent once a
 * year by the daily cron (`sendBirthdayNudgeEmails`). Fixed words only: no
 * date, no list, nothing anyone typed. It links to Home with New list open on
 * a Birthday list, through sign-in so that survives being signed out
 * (`BIRTHDAY_NUDGE_EMAIL_PATH`), and carries the unsubscribe link and headers
 * for `birthday_nudge`.
 */
export async function sendBirthdayNudgeEmail(email: string, details: BirthdayNudgeEmailDetails) {
  const heading = birthdayNudgeTitle(details.days);
  const button = 'Make a list';
  const url = `${env.NEXTAUTH_URL}${BIRTHDAY_NUDGE_EMAIL_PATH}`;
  const unsubscribe = notificationUnsubscribe(details.recipientId, 'birthday_nudge');
  const topic = NOTIFICATION_EVENTS.birthday_nudge.label.toLowerCase();

  const html = getEmailTemplate({
    title: heading,
    greeting: heading,
    contentHtml: `<p>${escapeHtml(BIRTHDAY_NUDGE_DETAIL)}</p>`,
    buttonText: button,
    buttonUrl: url,
    unsubscribeUrl: unsubscribe.page,
  });

  await deliver({
    kind: 'birthday_nudge notification',
    to: email,
    subject: 'Your birthday is coming up',
    html,
    text: `${heading}\n\n${BIRTHDAY_NUDGE_DETAIL}\n\n${button}: ${url}\n\nUnsubscribe from ${topic} emails: ${unsubscribe.page}`,
    link: url,
    unsubscribe,
  });
}
