import { BOOKMARKLET_CODE } from './code';
import { APP_ORIGIN_PLACEHOLDER } from './placeholder';

/** The built bookmarklet is held to this (the issue aims under 15 KB; it's far smaller). */
export const BOOKMARKLET_MAX_BYTES = 15_000;

/**
 * The bookmark's `javascript:` address for an app origin (`window.location.origin`:
 * scheme, host and port, no path). The code is percent-encoded so any browser
 * reads it back exactly. Null for an origin that isn't plain http(s).
 */
export function bookmarkletHref(origin: string): string | null {
  if (!/^https?:\/\/[^\s/?#'"\\]+$/.test(origin)) return null;
  return `javascript:${encodeURIComponent(BOOKMARKLET_CODE.split(APP_ORIGIN_PLACEHOLDER).join(origin))}`;
}
