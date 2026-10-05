import { randomBytes } from 'crypto';
import mongoose, { type FilterQuery } from 'mongoose';
import connectDB from '@/lib/mongodb';
import ShareLink, { type IShareLink } from '@/models/ShareLink';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import { duplicateKeyField } from '@/lib/utils/mongoErrors';
import {
  isShareTokenFormat,
  SHARE_TOKEN_LENGTH,
  type ShareLinkLevel,
} from '@/lib/utils/shareLinkFields';

export {
  isShareTokenFormat,
  shareTokenSchema,
  SHARE_LINK_CAP,
  SHARE_TOKEN_LENGTH,
} from '@/lib/utils/shareLinkFields';

/**
 * Share links (the Share links project, WIS-334): a list's secret `/l/<token>`
 * URLs, made and resolved. The model and its rules are in `models/ShareLink.ts`;
 * the pure fields and the token's shape in `lib/utils/shareLinkFields.ts`.
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/**
 * The bytes kept by the rejection sampling: 248 is the largest multiple of 62
 * a byte can hold, so `byte % 62` over 0–247 is uniform, and a byte of 248–255,
 * which would favour the first 8 characters, is thrown away.
 */
const UNBIASED_BYTE_LIMIT = 256 - (256 % BASE62.length);

/**
 * A new token: 22 base62 characters from `crypto.randomBytes`, by rejection
 * sampling so every character is equally likely. `random` is for tests.
 */
export function generateShareToken(random: (size: number) => Buffer = randomBytes): string {
  let token = '';
  while (token.length < SHARE_TOKEN_LENGTH) {
    // A few spare bytes: about 3% of them are thrown away.
    for (const byte of random(SHARE_TOKEN_LENGTH + 8)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      token += BASE62[byte % BASE62.length];
      if (token.length === SHARE_TOKEN_LENGTH) break;
    }
  }
  return token;
}

/** Whether a link has expired by `now`. A link without `expiresAt` never does. */
export function isShareLinkExpired(
  link: Pick<IShareLink, 'expiresAt'>,
  now: Date = new Date()
): boolean {
  return !!link.expiresAt && link.expiresAt.getTime() <= now.getTime();
}

/**
 * The links that haven't expired by `now`, as a query: `expiresAt` missing or
 * null (`null` matches both) or later than now. `isShareLinkExpired` is its
 * negation, so change them together.
 */
export function unexpiredShareLinkFilter(now: Date = new Date()): FilterQuery<IShareLink> {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

/** A live link and the list it opens. */
export interface ResolvedShareLink {
  link: IShareLink;
  wishlist: IWishlist;
}

/**
 * The live link a token opens, and its list; or `null` for a dead one: a token
 * of the wrong shape, unknown (or revoked), expired, or whose list is archived
 * or gone. Every dead link takes the same path and gets the same `null`, so a
 * caller can't tell them apart, and must not try to: they all show the one
 * unavailable state. The expiry is in the link's own query, so an expired link
 * is never even read.
 *
 * Admission still goes through `getWishlistViewAccess` with the resolved link,
 * which checks the link belongs to the list being opened.
 */
export async function resolveShareLink(
  token: unknown,
  now: Date = new Date()
): Promise<ResolvedShareLink | null> {
  if (!isShareTokenFormat(token)) return null;
  await connectDB();
  const link = await ShareLink.findOne({ token, ...unexpiredShareLinkFilter(now) }).lean();
  if (!link) return null;
  const wishlist = await Wishlist.findById(link.wishlist);
  if (!wishlist || wishlist.archived) return null;
  return { link, wishlist };
}

/**
 * How many people joined through each of `linkIds`, by link id. Always 0 for
 * now: joining through a link (WIS-337) fills it from the `WishlistMember` row
 * that records the link it came by. Every link asked about gets an entry.
 */
export async function countJoinedByLink(
  _wishlistId: string,
  linkIds: readonly mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  return new Map(linkIds.map((id) => [id.toString(), 0]));
}

/** A link as its list's owners see it in the API. */
export interface ShareLinkView {
  _id: string;
  level: ShareLinkLevel;
  label: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  state: 'live' | 'expired';
  joinedCount: number;
  /** Only in the owners' link list and the create answer. */
  token?: string;
}

/**
 * A link for an owners' answer. The token is left out unless `withToken`: only
 * the link list and the create answer carry it, so an edit's answer, say, can't
 * end up as a second place it travels. `createdBy` is never sent: links are the
 * list's, not their maker's.
 */
export function serializeShareLink(
  link: IShareLink,
  {
    now = new Date(),
    joinedCount = 0,
    withToken,
  }: { now?: Date; joinedCount?: number; withToken: boolean }
): ShareLinkView {
  return {
    _id: link._id.toString(),
    level: link.level,
    label: link.label ?? null,
    expiresAt: link.expiresAt ?? null,
    createdAt: link.createdAt,
    state: isShareLinkExpired(link, now) ? 'expired' : 'live',
    joinedCount,
    ...(withToken ? { token: link.token } : {}),
  };
}

/** How many tokens a create tries before giving up on duplicates. */
const MAX_TOKEN_ATTEMPTS = 3;

/**
 * Insert a new link with a fresh token. A token that clashes with an existing
 * one (as likely as guessing it: never, short of a broken random source) is
 * retried with a new one; the duplicate-key error quotes the token, so it's
 * never logged or rethrown whole. Any other error propagates. `generateToken`
 * is for tests.
 */
export async function insertShareLink(
  fields: {
    wishlistId: string;
    level: ShareLinkLevel;
    label: string | null;
    expiresAt: Date | null;
    createdBy: string;
  },
  { generateToken = generateShareToken }: { generateToken?: () => string } = {}
): Promise<IShareLink> {
  for (let attempt = 1; ; attempt++) {
    try {
      const doc = await ShareLink.create({
        wishlist: fields.wishlistId,
        token: generateToken(),
        level: fields.level,
        label: fields.label,
        expiresAt: fields.expiresAt,
        createdBy: fields.createdBy,
      });
      return doc.toObject();
    } catch (err) {
      if (duplicateKeyField(err) !== 'token') throw err;
      // Out of tries: an error that carries no token.
      if (attempt >= MAX_TOKEN_ATTEMPTS) throw new Error('Could not generate a unique share token');
    }
  }
}
