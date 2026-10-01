/** Where a step like the welcome page goes when its callback URL isn't usable. */
export const DEFAULT_CALLBACK_PATH = '/';

/**
 * The same-origin path (with its query and hash) to continue to after a step
 * like the welcome page, from a `callbackUrl` query value: a relative path, or
 * the absolute same-origin URL Auth.js passes along. Anything that would leave
 * `origin` (another host, a protocol-relative `//host`, a `javascript:` URL, a
 * path that starts with `//` once parsed) gives `/` instead, so the parameter
 * can't be used as an open redirect. So does a URL back to `avoidPath` (the
 * page doing the redirecting), which would loop.
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
