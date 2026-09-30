import mongoose, { Schema, Model } from 'mongoose';

const WishlistSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Human-readable URL slug (e.g. "birthday-2026-a1b2c"). Unique + sparse so
    // legacy rows without one are allowed until backfilled. Generated from the
    // name on creation; editable in settings.
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Co-owners. Every owner is equal: same authorization, same privacy (none of
    // them ever see booking status), the list shows on each of their profiles,
    // and each can pin it to their own dashboard (see `featuredBy`). Always has
    // at least one entry — the last owner can't be removed, only the wishlist
    // deleted. Owners are NOT rows in `WishlistMember`; that collection holds
    // only members (existence, no role field).
    owners: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    // Legacy flag, kept in sync with `visibility` (everyone ⇒ true).
    isPublic: {
      type: Boolean,
      default: true,
      required: true,
    },
    // Who can see this wishlist:
    //  - everyone: anyone with the link / on any owner's profile
    //  - friends:  any owner's friends (mutual follows) + members
    //  - private:  owners + explicit members only
    visibility: {
      type: String,
      enum: ['everyone', 'friends', 'private'],
      default: 'everyone',
      required: true,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    // Default currency for this wishlist (uppercase code). Prefilled from the
    // creating owner's default; editable in settings.
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
    },
    // Optional custom banner image (URL). When set, it replaces the generated
    // gradient on the wishlist's cover art. Falls back to the gradient if empty.
    bannerUrl: {
      type: String,
      required: false,
      default: null,
    },
    // Which owners pinned this list as the hero of *their* dashboard. "Featured"
    // is per-owner, not per-list: a co-owned family list can be the highlight
    // for one owner and not another. At most one list per owner (enforced in the
    // update route), and an owner is pulled out when they lose ownership.
    featuredBy: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// A wishlist without an owner is unreachable and unmanageable — never allow one.
// This only runs on create/save, not on `updateOne`: removals are guarded by the
// conditional write in `removeWishlistOwner` instead.
WishlistSchema.path('owners').validate(
  (v: mongoose.Types.ObjectId[]) => Array.isArray(v) && v.length > 0,
  'A wishlist must have at least one owner'
);

// "My wishlists" / profile listings look up by owner.
WishlistSchema.index({ owners: 1 });

// Base document type
export interface IWishlist {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug?: string | null;
  description?: string | null;
  owners: mongoose.Types.ObjectId[];
  isPublic: boolean;
  visibility: 'everyone' | 'friends' | 'private';
  archived?: boolean;
  currency?: string;
  featuredBy: mongoose.Types.ObjectId[];
  /**
   * Whether this list is the *viewer's* dashboard highlight. Not stored: it's
   * persisted per-owner in `featuredBy`, and API responses fold it down to this
   * boolean for the caller (see `serializeWishlist`).
   */
  featured?: boolean;
  bannerUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const Wishlist: Model<IWishlist> =
  mongoose.models.Wishlist || mongoose.model<IWishlist>('Wishlist', WishlistSchema);

export default Wishlist;
