import { getEmailTemplate, type RenderedEmail } from './layout';

/**
 * The sign-in email: the magic link Auth.js mints, sent only by the sign-in
 * form's Turnstile-checked server action (`lib/signInEmail.ts`). It carries no
 * unsubscribe: it's never sent unasked.
 */
export function magicLinkEmail(magicLink: string): RenderedEmail {
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

  return {
    kind: 'magic link',
    subject: `Sign in to ${siteTitle}`,
    html,
    text: `Sign in to ${siteTitle}\n\nHello!\n\nClick the link below to sign in to your ${siteTitle} account:\n${magicLink}\n\nThis link will expire in 24 hours.\n\nIf you didn't request this email, you can safely ignore it.`,
    link: magicLink,
  };
}
