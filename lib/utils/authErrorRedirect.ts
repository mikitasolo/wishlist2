import { safeCallbackPath } from './callbackUrl';

/** Auth.js's error page (`pages.error` in lib/auth.ts). */
export const AUTH_ERROR_PATH = '/auth/error';

/** The magic-link provider's id (Auth.js's `Nodemailer` default). */
const EMAIL_PROVIDER_ID = 'nodemailer';

/**
 * Whether a request path under Auth.js's base path (`/api/auth`) is the magic
 * link's callback, `/api/auth/callback/nodemailer`. Parsed the way Auth.js
 * parses it (`parseActionAndProviderId`), as `isMagicLinkSignInPath` does.
 */
export function isEmailCallbackPath(pathname: string, basePath = '/api/auth'): boolean {
  if (!pathname.startsWith(basePath)) return false;
  const [action, provider, ...rest] = pathname.slice(basePath.length).split('/').filter(Boolean);
  return action === 'callback' && provider === EMAIL_PROVIDER_ID && rest.length === 0;
}

/**
 * Where the magic link's callback should send someone whose link Auth.js
 * refused (expired or already used), so the error page's Try again still
 * leads to the page the link was for (WIS-305).
 *
 * Auth.js redirects such a link to `/auth/error?error=Verification` with only
 * the error type, although the link carries a `callbackUrl`. This adds that
 * `callbackUrl` to the redirect, reduced by `safeCallbackPath` to a path on
 * `origin` that isn't an auth page. It returns `null` (leave the redirect as it
 * is) for anything else: another path, a redirect that isn't to the error page
 * with `error=Verification`, one that already names a `callbackUrl`, or a
 * `callbackUrl` that is missing, off-site or would loop (which `safeCallbackPath`
 * turns into `/`, where the error page goes anyway). The redirect's own origin
 * and every other parameter are kept: only the destination after sign-in is
 * added, never where the redirect goes.
 */
export function verificationErrorLocation(
  requestUrl: URL,
  location: string | null,
  origin: string
): string | null {
  if (!location || !isEmailCallbackPath(requestUrl.pathname)) return null;
  let target: URL;
  try {
    target = new URL(location, origin);
  } catch {
    return null;
  }
  if (target.pathname !== AUTH_ERROR_PATH) return null;
  if (target.searchParams.get('error') !== 'Verification') return null;
  if (target.searchParams.has('callbackUrl')) return null;
  const path = safeCallbackPath(requestUrl.searchParams.get('callbackUrl'), origin, '/auth');
  if (path === '/') return null;
  target.searchParams.set('callbackUrl', path);
  return target.toString();
}
