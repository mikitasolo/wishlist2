import { z } from 'zod';
import { safeCallbackPath, SIGN_IN_PATH } from '@/lib/utils/callbackUrl';

/**
 * Where a sign-in will continue to, as far as the sign-in page says so: a
 * list's page or a profile, or nothing to mention. Worked out from the path
 * alone, never by reading the list or the profile, so the page can't name a
 * private list (or say whether it exists) to whoever opens the link.
 */
export type SignInDestination = 'wishlist' | 'profile' | null;

/** `/wishlists/<id or slug>`, but not the two pages of your own lists. */
const WISHLIST_PAGE = /^\/wishlists\/([^/]+)\/?$/;
const NOT_A_LIST = new Set(['mine', 'shared']);
const PROFILE_PAGE = /^\/users\/[^/]+\/?$/;

export function signInDestination(
  raw: string | null | undefined,
  origin: string
): SignInDestination {
  if (!raw) return null;
  // An off-site callback (which Auth.js wouldn't follow anyway) gives `/`.
  const path = safeCallbackPath(raw, origin, '/auth');
  const { pathname } = new URL(path, origin);
  const list = WISHLIST_PAGE.exec(pathname);
  // The raw segment: decoding a malformed escape (`%zz`) would throw mid-render.
  if (list && !NOT_A_LIST.has(list[1]!)) return 'wishlist';
  if (PROFILE_PAGE.test(pathname)) return 'profile';
  return null;
}

/** What the subtitle adds for a destination: generic on purpose. */
const DESTINATION_PHRASES: Record<Exclude<SignInDestination, null>, string> = {
  wishlist: ' to continue to the wishlist you opened',
  profile: ' to continue to the profile you opened',
};

/** The sign-in page's subtitle, saying where the link continues to when that's a list or a profile. */
export function signInSubtitle(destination: SignInDestination): string {
  return `We'll email you a link${destination ? DESTINATION_PHRASES[destination] : ''} — no password.`;
}

/**
 * The sign-in page to send someone back to from the error page, keeping where
 * they were going (`safeCallbackPath`: same-origin only, never back to an auth
 * page), or plain sign-in when there's nowhere worth keeping.
 */
export function signInRetryPath(raw: string | null | undefined, origin: string): string {
  const path = safeCallbackPath(raw, origin, '/auth');
  return path === '/' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(path)}`;
}

// The browser's own `type=email` rule (which `noValidate` turns off), no
// stricter: Zod's default pattern refuses real addresses (`a&b@…`, punycode
// TLDs) that the server and Auth.js accept.
const emailSchema = z.email({ pattern: z.regexes.html5Email });

/**
 * The sign-in form's inline check of the address typed: a hint, not a gate the
 * server relies on (`magicLinkRequestSchema` and Auth.js check it again).
 */
export function emailInputError(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Enter your email address';
  return emailSchema.safeParse(email).success
    ? null
    : 'Enter an email address like you@example.com';
}

/** How long the link-sent card holds Resend link back after a send. */
export const RESEND_DELAY_MS = 30_000;
