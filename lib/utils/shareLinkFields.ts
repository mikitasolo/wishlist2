import { z } from 'zod';

/**
 * A share link's fields and the token's shape (WIS-334): pure, so client code
 * (the owners' link list, `lib/validations.ts`) can use them. The server side,
 * which makes and resolves links, is `lib/utils/shareLinks.ts`.
 */

/** What a share link lets its holder do. Fixed when the link is made. */
export const SHARE_LINK_LEVELS = ['view', 'join'] as const;
export type ShareLinkLevel = (typeof SHARE_LINK_LEVELS)[number];

/** The longest label an owner may give a link. */
export const SHARE_LINK_LABEL_MAX = 40;

/** The most links one list may have, expired ones included. */
export const SHARE_LINK_CAP = 20;

/** How many characters a token has: 22 base62 characters, about 131 bits. */
export const SHARE_TOKEN_LENGTH = 22;

/**
 * A token's shape, `^[0-9A-Za-z]{22}$`. Anything taking a token from outside
 * (the `/l/[token]` param, the `X-Share-Token` header, a body) checks it with
 * this before any query, so an object like `{"$ne": null}`, or any string that
 * isn't a token, never reaches a filter.
 */
export const shareTokenSchema = z.string().regex(/^[0-9A-Za-z]{22}$/);

/** Whether `value` has a token's shape (`shareTokenSchema`). Run before any query that takes a token. */
export function isShareTokenFormat(value: unknown): value is string {
  return shareTokenSchema.safeParse(value).success;
}

/**
 * The request header a share link's token travels in on API calls (WIS-335):
 * never a query string, which the 5s items poll would put in request logs.
 * Only the list `GET`, the items `GET` and the join-request routes read it.
 */
export const SHARE_TOKEN_HEADER = 'X-Share-Token';

/**
 * The token of the share link a sign-in is headed back to (WIS-339): `raw` is
 * a `callbackUrl`, relative or absolute, and only `/l/<token>` on this site
 * (`origin`) counts, query and hash aside. Null for anything else: another
 * page, another site, a malformed URL or token. Where it leads is still decided
 * by `safeCallbackPath`, which keeps a same-origin path as it is.
 */
export function shareLinkTokenFromCallback(
  raw: string | null | undefined,
  origin: string
): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const match = /^\/l\/([^/]+)\/?$/.exec(url.pathname);
  return match && isShareTokenFormat(match[1]) ? match[1] : null;
}
