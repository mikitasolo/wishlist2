import mongoose, { FilterQuery } from 'mongoose';
import type { IWishlist } from '@/models/Wishlist';
import type { Occasion } from '@/lib/utils/occasion';

/**
 * Reading the owner set of a wishlist.
 *
 * Ownership is a *set* (`Wishlist.owners`), not a single user: all owners are
 * equal — same authorization, same privacy (no owner ever sees booking status),
 * the list appears on each of their profiles, and each can pin it to their own
 * dashboard. Everything that used to compare `wishlist.owner.toString() ===
 * userId` goes through `isWishlistOwner` here instead.
 */

/** The subset of a wishlist these helpers need — a doc, a `.lean()` row, or a plain object. */
export type OwnedWishlist = Pick<IWishlist, 'owners'>;

type Featurable = Pick<IWishlist, 'featuredBy'>;

function toIdString(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

/** Every owner's id, as strings. Never empty for a well-formed wishlist. */
export function ownerIds(wishlist: OwnedWishlist): string[] {
  return Array.isArray(wishlist.owners) ? wishlist.owners.map(toIdString) : [];
}

/**
 * The "primary" owner — `owners[0]`, i.e. whoever created the list (or the
 * earliest remaining owner). Owners are equal in authority, so this is only for
 * places that structurally need a single user: display fallbacks (`@x's
 * wishlist`) and the recipient snapshot on a `Reservation` / `GiftLog`.
 */
export function primaryOwnerId(wishlist: OwnedWishlist): string | null {
  return ownerIds(wishlist)[0] ?? null;
}

/** Whether `userId` is one of this wishlist's owners. */
export function isWishlistOwner(wishlist: OwnedWishlist, userId?: string | null): boolean {
  if (!userId) return false;
  return ownerIds(wishlist).includes(userId);
}

/** Query filter for "wishlists owned by this user". */
export function ownedByFilter(userId: string): FilterQuery<IWishlist> {
  return { owners: new mongoose.Types.ObjectId(userId) };
}

/** Whether this list is `userId`'s pinned dashboard highlight. */
export function isFeaturedBy(wishlist: Featurable, userId?: string | null): boolean {
  if (!userId) return false;
  const by = wishlist.featuredBy;
  return Array.isArray(by) && by.map(toIdString).includes(userId);
}

/**
 * A wishlist as clients see it: owner ids as strings, `featured` per-viewer,
 * and `occasion` always present (`null` for none).
 */
export type ApiWishlist = Omit<
  IWishlist,
  'owners' | 'featuredBy' | 'occasion' | 'idempotencyKey' | 'copyPending'
> & {
  owners: string[];
  featured: boolean;
  occasion: Occasion | null;
};

/**
 * Shape a wishlist for an API response: exposes the owner set as plain id
 * strings, folds the per-owner `featuredBy` set down to the boolean `featured`
 * *this viewer* cares about (so a co-owner's dashboard pin never reads as
 * yours), and drops the deprecated fields (the single-owner ones, the legacy
 * `isPublic` flag) so clients can't start depending on them again. The
 * occasion goes to every viewer: whoever may see the list may see its date, so
 * this adds no rule of its own, and a list saved before occasions existed reads
 * as `occasion: null`.
 */
export function serializeWishlist(
  wishlist: IWishlist & { toObject?: () => unknown },
  viewerId?: string | null
): ApiWishlist {
  const raw = (
    typeof wishlist.toObject === 'function' ? wishlist.toObject() : { ...wishlist }
  ) as IWishlist & { isPublic?: unknown };
  // `isPublic` is the legacy flag the schema dropped (WIS-184). A list stored
  // before then still carries it, and a read hands back what's stored, so it's
  // left out here rather than sent to clients that must not start reading it.
  // `idempotencyKey` and `copyPending` are never selected, but a list just
  // created still holds them (WIS-325): they're the server's, never the client's.
  const {
    owners: _owners,
    featuredBy: _featuredBy,
    isPublic: _isPublic,
    idempotencyKey: _idempotencyKey,
    copyPending: _copyPending,
    ...rest
  } = raw;
  return {
    ...rest,
    owners: ownerIds(wishlist),
    featured: isFeaturedBy(wishlist, viewerId),
    occasion: rest.occasion ?? null,
  };
}
