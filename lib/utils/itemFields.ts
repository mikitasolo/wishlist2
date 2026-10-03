/**
 * Limits and normalisation shared by the item form and the item schemas, so the
 * two never disagree about what an item may hold.
 */

/** The longest an item's notes may be (size, colour, model…). */
export const ITEM_NOTES_MAX = 300;

// `scheme:` at the start, as in `https://x`, `javascript:x` or `mailto:x`.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `host:port`, which reads like a scheme but is an address: `localhost:3000/x`.
const HOST_WITH_PORT = /^[^/?#:]+:\d+(?:[/?#]|$)/;

/**
 * A product link as typed, made one the schema accepts: trimmed, with
 * `https://` put in front of one that has no scheme ("amazon.de/dp/1"). One
 * that names a scheme is left alone, so a `javascript:` or `ftp:` link is still
 * refused by `isHttpUrl` rather than turned into something else. Empty stays
 * empty.
 */
export function normalizeItemLink(raw: string): string {
  const link = raw.trim();
  if (!link) return '';
  if (HAS_SCHEME.test(link) && !HOST_WITH_PORT.test(link)) return link;
  return `https://${link.replace(/^\/\//, '')}`;
}

/** Whether `value` is an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
