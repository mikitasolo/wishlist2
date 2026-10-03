/** Where a step like the welcome page goes when its callback URL isn't usable. */
export const DEFAULT_CALLBACK_PATH = '/';

/** The sign-in page (`pages.signIn` in lib/auth.ts). */
export const SIGN_IN_PATH = '/auth/signin';

/**
 * The pages that need an account: each sends a signed-out visitor to
 * `signInPath(<its own path>)`, and signing out on one goes home rather than
 * reloading it (`AuthButton`). A new such page goes here, or `signInPath`
 * won't take its path.
 */
export const AUTH_ONLY_PATHS = [
  '/invites',
  '/booked',
  '/settings',
  '/items',
  '/notifications',
  '/wishlists/mine',
  '/wishlists/shared',
] as const;

export type AuthOnlyPath = (typeof AUTH_ONLY_PATHS)[number];

/** Whether `pathname` (a URL's path, without its query) is one of the pages that need an account. */
export function isAuthOnlyPath(pathname: string): boolean {
  return (AUTH_ONLY_PATHS as readonly string[]).includes(pathname);
}

/**
 * The sign-in page, continuing to `page` once signed in: where a page that
 * needs an account sends a signed-out visitor, so where they were going isn't
 * lost.
 */
export function signInPath(page: AuthOnlyPath): string {
  return `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(page)}`;
}

/**
 * The same-origin path (with its query and hash) to continue to after a step
 * like the welcome page, from a `callbackUrl` query value: a relative path, or
 * the absolute same-origin URL Auth.js passes along. Anything that would leave
 * `origin` (another host, a protocol-relative `//host`, a `javascript:` URL, a
 * path that starts with `//` once parsed) gives `/` instead, so the parameter
 * can't be used as an open redirect. So does a URL back to `avoidPath` (the
 * page doing the redirecting, or the section it's in) or anywhere under it,
 * which would loop.
 */
export function safeCallbackPath(
  raw: string | null | undefined,
  origin: string,
  avoidPath?: string
): string {
  if (!raw) return DEFAULT_CALLBACK_PATH;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return DEFAULT_CALLBACK_PATH;
  }
  if (url.origin !== origin) return DEFAULT_CALLBACK_PATH;
  // `http://host//evil.example` is same-origin, but its path read on its own is
  // protocol-relative: navigating to `//evil.example` leaves the site.
  if (url.pathname.startsWith('//')) return DEFAULT_CALLBACK_PATH;
  if (avoidPath && (url.pathname === avoidPath || url.pathname.startsWith(`${avoidPath}/`))) {
    return DEFAULT_CALLBACK_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
