import mongoose, { Schema, Model } from 'mongoose';

/**
 * Someone kicked from a list, kept out of its share links (WIS-338).
 *
 * A **kick** (an owner removing a member) writes one, once the membership is
 * gone; leaving of your own accord doesn't, nor does an owner being demoted or
 * removed. While it's there, any of the list's share links answers that account
 * (signed in) with the dead-link state, View and Join alike, reads and joins
 * alike: `lib/utils/linkBlocks.ts`, checked where a link is resolved
 * (`admitListViewer`, the `/l/[token]` page). Only an owner's invite brings them
 * back, and accepting it (as a member or an owner) deletes the row.
 *
 * Deleting the list deletes its rows (`deleteOwnedWishlist`); deleting the
 * account deletes the rows about it (`deleteAccount`).
 */
const WishlistLinkBlockSchema = new Schema(
  {
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One per person per list, so a second kick (or two at once) upserts the same
// row. The collection is new, so Mongoose's autoIndex builds it on an empty
// collection and no migration is needed.
WishlistLinkBlockSchema.index({ wishlist: 1, user: 1 }, { unique: true });
// The rows about one account (its deletion).
WishlistLinkBlockSchema.index({ user: 1 });

export interface IWishlistLinkBlock {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  createdAt: Date;
}

const WishlistLinkBlock: Model<IWishlistLinkBlock> =
  mongoose.models.WishlistLinkBlock ||
  mongoose.model<IWishlistLinkBlock>('WishlistLinkBlock', WishlistLinkBlockSchema);

export default WishlistLinkBlock;
