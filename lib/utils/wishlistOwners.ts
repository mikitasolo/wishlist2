import mongoose, { FilterQuery } from 'mongoose';
import type { IWishlist } from '@/models/Wishlist';

/**
 * Reading the owner set of a wishlist.
 *
 * Ownership is a *set* (`Wishlist.owners`), not a single user: all owners are
 * equal — same authorization, same privacy (no owner ever sees booking status),
 * the list appears on each of their profiles, and each can pin it to their own
 * dashboard. Everything that used to compare `wishlist.owner.toString() ===
 * userId` goes through `isWishlistOwner` here instead.
 *
 * All readers tolerate rows written before the `owners[]` migration by falling
 * back to the legacy single `owner` field.
 */

/** The subset of a wishlist these helpers need — a doc, a `.lean()` row, or a plain object. */
export type OwnedWishlist = Pick<IWishlist, 'owners'> & Pick<Partial<IWishlist>, 'owner'>;

type Featurable = Pick<IWishlist, 'featuredBy'> & Pick<Partial<IWishlist>, 'featured' | 'owner'>;

function toIdString(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

/** Every owner's id, as strings. Never empty for a well-formed wishlist. */
export function ownerIds(wishlist: OwnedWishlist): string[] {
  const owners = wishlist.owners;
  if (Array.isArray(owners) && owners.length > 0) return owners.map(toIdString);
  // Legacy row that predates `owners[]`.
  return wishlist.owner ? [toIdString(wishlist.owner)] : [];
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

/**
 * Query filter for "wishlists owned by this user".
 *
 * The two legacy clauses match rows the `wishlist-owners` migration hasn't
 * reached yet; drop them once it has run everywhere. NOTE: this returns a top
 * level `$or`, so combine it with another `$or` via `$and`, never by spreading.
 */
export function ownedByFilter(userId: string): FilterQuery<IWishlist> {
  const uid = new mongoose.Types.ObjectId(userId);
  return {
    $or: [
      { owners: uid },
      { owner: uid, owners: { $size: 0 } },
      { owner: uid, owners: { $exists: false } },
    ],
  };
}

/**
 * Whether this list is `userId`'s pinned dashboard highlight.
 *
 * The legacy `featured` flag is consulted only for rows that haven't been
 * migrated at all (no `owners`). Once `owners` is set, `featuredBy` is the whole
 * truth — otherwise an owner who was un-pinned (leaving `featuredBy` empty) would
 * fall back to a stale legacy flag and look pinned again.
 */
export function isFeaturedBy(wishlist: Featurable & { owners?: unknown }, userId?: string | null) {
  if (!userId) return false;
  const migrated = Array.isArray(wishlist.owners) && wishlist.owners.length > 0;
  if (migrated) {
    const by = wishlist.featuredBy;
    return Array.isArray(by) && by.map(toIdString).includes(userId);
  }
  // Un-migrated row: only the (single) legacy owner could have set the flag.
  return !!wishlist.featured && !!wishlist.owner && toIdString(wishlist.owner) === userId;
}

/** A wishlist as clients see it: owner ids as strings, `featured` per-viewer. */
export type ApiWishlist = Omit<IWishlist, 'owner' | 'owners' | 'featuredBy'> & {
  owners: string[];
  featured: boolean;
};

/**
 * Shape a wishlist for an API response: exposes the owner set as plain id
 * strings, folds the per-owner `featuredBy` set down to the boolean `featured`
 * *this viewer* cares about (so a co-owner's dashboard pin never reads as
 * yours), and drops the deprecated single-owner fields so clients can't start
 * depending on them again.
 */
export function serializeWishlist(
  wishlist: IWishlist & { toObject?: () => unknown },
  viewerId?: string | null
): ApiWishlist {
  const raw = (
    typeof wishlist.toObject === 'function' ? wishlist.toObject() : { ...wishlist }
  ) as IWishlist;
  const { owner: _owner, owners: _owners, featuredBy: _featuredBy, ...rest } = raw;
  return {
    ...rest,
    owners: ownerIds(wishlist),
    featured: isFeaturedBy(wishlist, viewerId),
  };
}
