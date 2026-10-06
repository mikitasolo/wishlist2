import mongoose, { Schema, Model } from 'mongoose';

/**
 * One "Start a new list from this one" request (WIS-325), by its
 * `Idempotency-Key`. Written first, before anything is copied, so a retry of
 * the same request finds it: while `done` is false the copy is still being
 * made (or its attempt died), and the new list doesn't exist yet. The list
 * (`wishlist`, its id chosen up front) is written last, so nothing can read,
 * share, invite to or count a list that isn't finished.
 *
 * `copiedUrls` records each image copied into the starter's uploads as soon as
 * it lands, so a copy that never finishes can be taken back whole: its items
 * (already written under `wishlist`) and those blobs. A row left unfinished
 * past `COPY_STALE_MS` is taken back by the starter's next copy
 * (`settleStaleCopies`, `lib/utils/wishlistCopies.ts`). A finished row only
 * answers retries, and expires a day later (`expiresAt`, TTL).
 *
 * Deleting the account deletes its rows, and an unfinished row's items
 * (`deleteAccount`); its blobs go with the account's uploads.
 */
const WishlistCopySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** The request's key, scoped to `user` (`scopedIdempotencyKey`). */
    key: { type: String, required: true },
    /** The new list's id, chosen before it's written. */
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    copiedUrls: { type: [String], default: [] },
    done: { type: Boolean, default: false },
    expiresAt: { type: Date, required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One copy per request: a retry racing the first attempt is refused here.
WishlistCopySchema.index({ key: 1 }, { unique: true });
// A user's unfinished copies (the stale sweep), and all of them (account deletion).
WishlistCopySchema.index({ user: 1, done: 1 });
// Finished rows go a day after (unfinished ones have no `expiresAt`).
WishlistCopySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IWishlistCopy {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  key: string;
  wishlist: mongoose.Types.ObjectId;
  copiedUrls: string[];
  done: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

const WishlistCopy: Model<IWishlistCopy> =
  mongoose.models.WishlistCopy || mongoose.model<IWishlistCopy>('WishlistCopy', WishlistCopySchema);

export default WishlistCopy;
