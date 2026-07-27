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
    // only 'admin' / 'member'.
    owners: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    /**
     * @deprecated Pre-multi-owner single owner. Superseded by `owners[]`; kept so
     * rows written before the migration can still be resolved (and so the
     * `wishlist-owners` migration can read them). Nothing in the app authorizes
     * against it — use the helpers in `lib/utils/wishlistOwners.ts`.
     */
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
    /**
     * @deprecated Pre-multi-owner featured flag. Superseded by `featuredBy[]`;
     * read only by the `wishlist-owners` migration.
     */
    featured: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

// Transitional shim: accept the pre-multi-owner write shape (`{ owner }`) by
// seeding `owners` from it, so anything still constructing a wishlist the old
// way produces a valid multi-owner document instead of an unowned one.
WishlistSchema.pre('validate', function seedOwners(next) {
  if ((!this.owners || this.owners.length === 0) && this.owner) {
    this.owners = [this.owner];
  }
  next();
});

// A wishlist without an owner is unreachable and unmanageable — never allow one.
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
  /** @deprecated see the schema note — resolve owners via `lib/utils/wishlistOwners.ts`. */
  owner?: mongoose.Types.ObjectId | null;
  isPublic: boolean;
  visibility: 'everyone' | 'friends' | 'private';
  archived?: boolean;
  currency?: string;
  featuredBy: mongoose.Types.ObjectId[];
  /**
   * Whether this list is the *viewer's* dashboard highlight. Persisted per-owner
   * in `featuredBy`; API responses fold it down to this boolean for the caller
   * (see `serializeWishlist`). The legacy stored flag of the same name is only
   * read by the migration.
   */
  featured?: boolean;
  bannerUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const Wishlist: Model<IWishlist> =
  mongoose.models.Wishlist || mongoose.model<IWishlist>('Wishlist', WishlistSchema);

export default Wishlist;
