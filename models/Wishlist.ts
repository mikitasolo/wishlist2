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
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Legacy flag, kept in sync with `visibility` (everyone ⇒ true).
    isPublic: {
      type: Boolean,
      default: true,
      required: true,
    },
    // Who can see this wishlist:
    //  - everyone: anyone with the link / on your profile
    //  - friends:  the owner's friends (mutual follows) + members
    //  - private:  owner + explicit members only
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
    // owner's default on creation; editable in settings.
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
    // Owner-pinned "featured" list for their dashboard hero. At most one per
    // owner is true at a time (enforced in the update route).
    featured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster lookups
WishlistSchema.index({ owner: 1 });

// Base document type
export interface IWishlist {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug?: string | null;
  description?: string | null;
  owner: mongoose.Types.ObjectId;
  isPublic: boolean;
  visibility: 'everyone' | 'friends' | 'private';
  archived?: boolean;
  currency?: string;
  featured?: boolean;
  bannerUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const Wishlist: Model<IWishlist> =
  mongoose.models.Wishlist || mongoose.model<IWishlist>('Wishlist', WishlistSchema);

export default Wishlist;
