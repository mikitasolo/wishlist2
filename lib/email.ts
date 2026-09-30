import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { getEnvVars } from './env';

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
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASSWORD,
        },
      })
    : null;

// The brand logo, mirroring app/icon.svg. Email clients render SVG poorly and
// block remote images by default, so we rasterize it to a PNG and embed it as
// an inline (CID) attachment — that renders everywhere without a network fetch.
const LOGO_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#8f8dff"/><stop offset="0.5" stop-color="#5e5ce6"/><stop offset="1" stop-color="#4644c0"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#g)"/>
  <rect x="18.5" y="27" width="27" height="19" rx="4.5" fill="#fff"/>
  <rect x="29.4" y="27" width="5.2" height="19" fill="#5e5ce6"/>
  <path d="M32 27 21.5 20.5 23.6 28.5Z" fill="#fff"/>
  <path d="M32 27 42.5 20.5 40.4 28.5Z" fill="#fff"/>
  <circle cx="32" cy="26.4" r="2.8" fill="#fff"/>
</svg>`;

const LOGO_CID = 'wishlist-logo';

let logoPngPromise: Promise<Buffer> | null = null;
function getLogoPng(): Promise<Buffer> {
  if (!logoPngPromise) {
    // 2x (96px) for retina; rendered at 48px in the header.
    logoPngPromise = sharp(Buffer.from(LOGO_SVG))
      .resize(96, 96)
      .png()
      .toBuffer()
      .catch((err) => {
        logoPngPromise = null; // don't cache the failure — retry next send
        throw err;
      });
  }
  return logoPngPromise;
}

/** Inline logo attachment for an email, or null if it can't be produced. */
async function logoAttachment() {
  try {
    return { filename: 'logo.png', content: await getLogoPng(), cid: LOGO_CID };
  } catch (err) {
    console.error('Could not render email logo, sending without it:', err);
    return null;
  }
}

interface OutgoingEmail {
  /** What kind of email this is, for log lines. Never the recipient. */
  kind: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The link the email exists to deliver (magic link, invitations page, …). */
  link: string;
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
 *   nothing. For local dev; `lib/env` refuses it in production.
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

  const logo = await logoAttachment();
  try {
    await smtpTransporter.sendMail({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: logo ? [logo] : [],
    });
    console.log(`Sent ${email.kind} email`);
  } catch (error) {
    const reason = describeSendError(error);
    console.error(`Error sending ${email.kind} email: ${reason}`);
    throw new Error(`Could not send ${email.kind} email (${reason})`);
  }
}

/**
 * Generate beautiful HTML email template
 */
function getEmailTemplate(options: {
  title: string;
  greeting: string;
  content: string;
  buttonText?: string;
  buttonUrl?: string;
  footerText?: string;
  showLinkFallback?: boolean;
  linkUrl?: string;
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
              <h2>${options.greeting}</h2>
              ${options.content}

              ${
                options.buttonText && options.buttonUrl
                  ? `<div class="button-container">
                  <a href="${options.buttonUrl}" class="email-button">${options.buttonText}</a>
                </div>`
                  : ''
              }

              ${
                options.showLinkFallback && options.linkUrl
                  ? `<div class="link-fallback">
                  <p>Or paste this link into your browser:</p>
                  <a href="${options.linkUrl}">${options.linkUrl}</a>
                </div>`
                  : ''
              }
            </div>

            <div class="email-footer">
              ${options.footerText ? `<p>${options.footerText}</p>` : ''}
              <p>Sent by ${siteTitle} · If you didn’t request this, you can safely ignore it.</p>
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
    content: `
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

export async function sendWishlistInvitationEmail(
  email: string,
  wishlistName: string,
  invitedBy: string
) {
  const siteTitle = 'Wishlist';
  // Land on the invites page (via sign-in) where they can accept or decline.
  const invitesUrl = `${env.NEXTAUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent('/invites')}`;

  const html = getEmailTemplate({
    title: 'Wishlist invitation',
    greeting: `You’re invited to “${wishlistName}”`,
    content: `
      <p><strong>${invitedBy}</strong> invited you to their wishlist <strong>${wishlistName}</strong>.</p>
      <p>Sign in to your account to review the invitation — you can accept or decline it.</p>
    `,
    buttonText: 'Review invitation',
    buttonUrl: invitesUrl,
    footerText: `Invitation sent to <strong>${email}</strong>`,
  });

  await deliver({
    kind: 'wishlist invitation',
    to: email,
    subject: `You've been invited to ${wishlistName} on ${siteTitle}!`,
    html,
    text: `Wishlist Invitation\n\n${invitedBy} has invited you to join their wishlist: ${wishlistName}.\n\nSign in to your account to accept or decline it: ${invitesUrl}`,
    link: invitesUrl,
  });
}
