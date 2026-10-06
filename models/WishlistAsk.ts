import mongoose, { Schema, Model } from 'mongoose';

/**
 * A friend asking someone to make a wishlist (WIS-324): `asker` found no list
 * of `person`'s they could open, and asked for one.
 *
 * One row per (asker, person), reused: an ask is live from `askedAt` for
 * `WISHLIST_ASK_WINDOW_MS` (30 days, `lib/utils/wishlistAsks.ts`) until
 * `answeredAt` is set, which happens when `person` makes a list the asker can
 * open and the asker is told about it. There's no decline: a live ask quietly
 * expires. Asking again once it has expired, or once it was answered, moves
 * the same row forward (`askForWishlist`), so the unique index is what holds
 * the "one ask per 30 days" rule against two asks at once.
 *
 * Nobody but the asker ever reads their row: the person sees only the
 * notification, and other askers see nothing. Both sides leave with their
 * account (`deleteAccount`).
 */
const WishlistAskSchema = new Schema(
  {
    asker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    person: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    askedAt: { type: Date, required: true },
    // Set once the asker was told about a list made since; a live ask has none.
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One row per asker per person: the ask's conditional upsert relies on it.
// The collection is new, so autoIndex builds it on an empty collection and no
// migration is needed.
WishlistAskSchema.index({ asker: 1, person: 1 }, { unique: true });
// A person's live asks, read when they make a list; and an account's cleanup.
WishlistAskSchema.index({ person: 1, askedAt: -1 });

export interface IWishlistAsk {
  _id: mongoose.Types.ObjectId;
  asker: mongoose.Types.ObjectId;
  person: mongoose.Types.ObjectId;
  askedAt: Date;
  answeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WishlistAsk: Model<IWishlistAsk> =
  mongoose.models.WishlistAsk || mongoose.model<IWishlistAsk>('WishlistAsk', WishlistAskSchema);

export default WishlistAsk;
