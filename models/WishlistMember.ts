import mongoose, { Schema, Model } from 'mongoose';

/**
 * Someone who has been invited onto a wishlist and accepted: they can see it,
 * propose items, and book gifts.
 *
 * Membership has no role. A wishlist has exactly two kinds of people — **owners**
 * (`Wishlist.owners`, who manage the list and can't see bookings) and **members**
 * (rows here, who gift). There used to be an `admin` role in between; it was a
 * manager-of-someone-else's-list, which isn't a relationship this app needs —
 * anyone trusted to manage the list is a co-owner.
 */
const WishlistMemberSchema = new Schema(
  {
    wishlist: {
      type: Schema.Types.ObjectId,
      ref: 'Wishlist',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // The share link they joined through (WIS-337), for the owners' per-link
    // joined count (`countJoinedByLink`). Set only when a link join created the
    // row; absent on a membership from an invite, and never changed after. It
    // may name a link revoked since, which then counts nowhere.
    viaLink: { type: Schema.Types.ObjectId, ref: 'ShareLink', default: undefined },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure a user is only a member of a wishlist once
WishlistMemberSchema.index({ wishlist: 1, user: 1 }, { unique: true });
// A member's lists. A list's members need no index of their own: the unique
// `{ wishlist, user }` above serves them. A separate `{ wishlist: 1 }` did
// until WIS-377, which dropped it (`POST /api/migrations/sync-hot-query-indexes`).
WishlistMemberSchema.index({ user: 1 });

// Base document type
export interface IWishlistMember {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  viaLink?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const WishlistMember: Model<IWishlistMember> =
  mongoose.models.WishlistMember ||
  mongoose.model<IWishlistMember>('WishlistMember', WishlistMemberSchema);

export default WishlistMember;
