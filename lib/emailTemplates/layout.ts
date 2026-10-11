import type { NotificationEvent } from '@/lib/utils/notificationPrefs';

/**
 * The shared layout of every email, and the types each template module in
 * `lib/emailTemplates/` builds on (WIS-375). Templates are pure: they read no
 * env, database or clock, and send nothing. `lib/email.ts` is the transport
 * that delivers what they render, and the dev-only gallery (`/dev/emails`)
 * renders them with fixture data.
 */

/** A notification email's unsubscribe links (`unsubscribeUrls`). */
export interface Unsubscribe {
  /** The footer link: a page with one button (`/unsubscribe`). */
  page: string;
  /** The header's target, which a mail client POSTs to (`/api/unsubscribe`). */
  oneClick: string;
}

/** What a template needs besides its own details. */
export interface EmailContext {
  /** The app's origin (`NEXTAUTH_URL`), which every link we build starts with. */
  siteUrl: string;
  /** The recipient's unsubscribe links for `event`: they turn off that event's email only. */
  unsubscribe(event: NotificationEvent): Unsubscribe;
}

/** An email, ready for `deliver` once given a recipient. */
export interface RenderedEmail {
  /** What kind of email this is, for log lines. Never the recipient. */
  kind: string;
  subject: string;
  html: string;
  text: string;
  /** The link the email exists to deliver (magic link, invitations page, …). */
  link: string;
  /**
   * A notification email's one-click unsubscribe: sent as `List-Unsubscribe` +
   * `List-Unsubscribe-Post` (RFC 8058), so a mail client's own Unsubscribe
   * turns off just this email. Never on a magic link.
   */
  unsubscribe?: Unsubscribe;
}

/**
 * The brand logo's Content-ID. Email clients render SVG poorly and block
 * remote images by default, so the layout points at an inline (CID) PNG that
 * `deliver` attaches under this id (the gallery swaps in a data URL instead).
 */
export const LOGO_CID = 'wishlist-logo';

/** The footer links of a notification email: its unsubscribe page, and Settings. */
export function notificationFooter(ctx: EmailContext, unsubscribe: Unsubscribe) {
  return { page: unsubscribe.page, settings: `${ctx.siteUrl}/settings#notifications` };
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
export function escapeHtml(value: string): string {
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
export function getEmailTemplate(options: {
  title: string;
  greeting: string;
  contentHtml: string;
  buttonText?: string;
  buttonUrl?: string;
  footerHtml?: string;
  showLinkFallback?: boolean;
  linkUrl?: string;
  /**
   * A notification email's unsubscribe page (`Unsubscribe.page`) and the
   * Settings page: the footer then offers both, in place of "If you didn’t
   * request this".
   */
  unsubscribe?: { page: string; settings: string };
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
              <img src="cid:${LOGO_CID}" width="48" height="48" alt="Wishlist" class="brand-badge" />
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
                options.unsubscribe
                  ? `<p>Sent by ${siteTitle} · <a href="${escapeHtml(options.unsubscribe.page)}">Unsubscribe from these emails</a> · <a href="${escapeHtml(options.unsubscribe.settings)}">Notification settings</a></p>`
                  : `<p>Sent by ${siteTitle} · If you didn’t request this, you can safely ignore it.</p>`
              }
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}
