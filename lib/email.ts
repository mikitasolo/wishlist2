import nodemailer from 'nodemailer';
import { getEnvVars } from './env';
import { EMAIL_LOGO_PNG_BASE64 } from './emailLogo';
import { unsubscribeUrls } from './utils/unsubscribe';
import {
  LOGO_CID,
  type EmailContext,
  type RenderedEmail,
  type Unsubscribe,
} from './emailTemplates/layout';
import { magicLinkEmail } from './emailTemplates/magicLink';
import {
  wishlistInvitationEmail,
  type WishlistInvitationDetails,
} from './emailTemplates/wishlistInvite';
import { notificationEmail, type NotificationEmailDetails } from './emailTemplates/notification';
import { birthdayNudgeEmail, type BirthdayNudgeEmailDetails } from './emailTemplates/birthdayNudge';

/**
 * The email transport (WIS-375): how an email leaves the app, and the one
 * `send…` function per email that callers use. What each email says lives in
 * its own template module under `lib/emailTemplates/` (the shared layout and
 * escaping in `layout.ts`), which reads no env and sends nothing.
 */

export type { WishlistInvitationDetails } from './emailTemplates/wishlistInvite';
export type {
  EmailedNotificationType,
  NotificationEmailDetails,
} from './emailTemplates/notification';
export type { BirthdayNudgeEmailDetails } from './emailTemplates/birthdayNudge';

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

// The brand logo, attached inline under `LOGO_CID` (see there). The PNG is
// pre-rendered from app/icon.svg (scripts/generate-email-logo.mjs), so sending
// an email needs no sharp at all: NextAuth and the sign-in form's server action
// import this file, and a sharp that couldn't load there (WIS-156) once took
// sign-in down.
const LOGO_PNG = Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64');

interface OutgoingEmail extends RenderedEmail {
  to: string;
}

/**
 * The links and unsubscribe of an email to the account `recipientId`: each
 * event's unsubscribe turns off that event's email, and only for that account.
 */
function contextFor(recipientId: string): EmailContext {
  return {
    siteUrl: env.NEXTAUTH_URL,
    unsubscribe: (event) => unsubscribeUrls(env.NEXTAUTH_URL, { userId: recipientId, event }),
  };
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

/** The sign-in email (`lib/emailTemplates/magicLink.ts`). */
export async function sendMagicLinkEmail(email: string, magicLink: string) {
  await deliver({ to: email, ...magicLinkEmail(magicLink) });
}

/** An invitation to a list (`lib/emailTemplates/wishlistInvite.ts`). */
export async function sendWishlistInvitationEmail(
  email: string,
  details: WishlistInvitationDetails
) {
  await deliver({
    to: email,
    ...wishlistInvitationEmail(email, details, contextFor(details.recipientId)),
  });
}

/**
 * A notification's email (`lib/emailTemplates/notification.ts`, its copy in
 * `lib/emailTemplates/notifications/`): never more than its in-app row says.
 */
export async function sendNotificationEmail(email: string, details: NotificationEmailDetails) {
  await deliver({ to: email, ...notificationEmail(details, contextFor(details.recipientId)) });
}

/** The nudge to make a list before your own birthday (`lib/emailTemplates/birthdayNudge.ts`). */
export async function sendBirthdayNudgeEmail(email: string, details: BirthdayNudgeEmailDetails) {
  await deliver({ to: email, ...birthdayNudgeEmail(details, contextFor(details.recipientId)) });
}
