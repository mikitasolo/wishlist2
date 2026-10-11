import { EMAIL_LOGO_PNG_BASE64 } from '@/lib/emailLogo';
import { birthdayNudgeEmail } from './birthdayNudge';
import { EMAIL_FIXTURES, FIXTURE_RECIPIENT, type EmailFixture } from './fixtures';
import { LOGO_CID, type EmailContext, type RenderedEmail } from './layout';
import { magicLinkEmail } from './magicLink';
import { notificationEmail } from './notification';
import { wishlistInvitationEmail } from './wishlistInvite';

/**
 * The dev-only email gallery's renderer (`/dev/emails`, WIS-375): every
 * fixture through its real template, with no env read beyond the site URL it's
 * given, no database and no send. Only that page imports this, and only once
 * its gate (`isLocalDevRuntime`) has passed.
 */

/**
 * A context whose unsubscribe links are made up: unsigned, so they unsubscribe
 * no one (the page they open says the link doesn't work), and no secret is read.
 */
export function galleryContext(siteUrl: string): EmailContext {
  return {
    siteUrl,
    unsubscribe: (event) => ({
      page: `${siteUrl}/unsubscribe?e=${event}&fixture=1`,
      oneClick: `${siteUrl}/api/unsubscribe?e=${event}&fixture=1`,
    }),
  };
}

/** One fixture's email, exactly as its template renders it for sending. */
export function renderFixture(fixture: EmailFixture, ctx: EmailContext): RenderedEmail {
  switch (fixture.template) {
    case 'magic_link':
      return magicLinkEmail(fixture.magicLink);
    case 'wishlist_invite':
      return wishlistInvitationEmail(FIXTURE_RECIPIENT.email, fixture.details, ctx);
    case 'notification':
      return notificationEmail(fixture.details, ctx);
    case 'birthday_nudge':
      return birthdayNudgeEmail(fixture.details, ctx);
  }
}

/**
 * The HTML for a browser preview: the inline logo, which a mail client finds
 * among the message's attachments (`cid:`), as a data URL instead.
 */
export function previewHtml(html: string): string {
  return html.replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${EMAIL_LOGO_PNG_BASE64}`);
}

export interface GalleryEntry {
  fixture: EmailFixture;
  email: RenderedEmail;
  preview: string;
}

/** Every email in the gallery, in fixture order. */
export function galleryEntries(siteUrl: string): GalleryEntry[] {
  const ctx = galleryContext(siteUrl);
  return EMAIL_FIXTURES.map((fixture) => {
    const email = renderFixture(fixture, ctx);
    return { fixture, email, preview: previewHtml(email.html) };
  });
}
