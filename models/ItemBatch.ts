import mongoose, { Schema, Model } from 'mongoose';

/**
 * One bulk item action (WIS-386), by its `Idempotency-Key`, so a retry of the
 * same request (its answer lost to a timeout, say) is answered as the first
 * attempt was rather than applied again. Written first, before any item is
 * touched: a retry racing the first attempt is refused by the unique index,
 * and while `done` is false the batch is still being applied (or its attempt
 * died: a row left unfinished past `ITEM_BATCH_STALE_MS` is dropped and the
 * batch applied again, which every bulk action is safe to be).
 *
 * `payload` is a digest of the list, the action and the ids, so a key sent
 * again with a different change is refused rather than answered with another
 * batch's result. Every row expires a day after it was written (`expiresAt`,
 * TTL), finished or not, a move's after a week (`ITEM_BATCH_MOVE_TTL_MS`, so
 * the daily sweep of dead moves, `settleAllDeadMoves`, always reaches one),
 * and deleting the account deletes its rows (`deleteAccount`).
 */
const ItemBatchSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** The request's key, scoped to `user` (`scopedIdempotencyKey`). */
    key: { type: String, required: true },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    /** sha256 of the list, the action and the sorted ids. */
    payload: { type: String, required: true },
    done: { type: Boolean, default: false },
    /** The ids as the first attempt sorted them (see `BulkItemResult`). */
    result: {
      done: { type: [String], default: undefined },
      skipped: { type: [String], default: undefined },
      gone: { type: [String], default: undefined },
      failed: { type: [String], default: undefined },
    },
    /**
     * A move's copies (WIS-434), recorded before they're written: each moved
     * item's id, its copy's, and the image copied for it. An attempt that dies
     * between writing a copy and deleting its item would leave the item on
     * both lists; settling the row (`settleDeadMove`) takes back each copy
     * whose item is still there.
     */
    moves: {
      type: [
        {
          _id: false,
          from: { type: Schema.Types.ObjectId, required: true },
          to: { type: Schema.Types.ObjectId, required: true },
          imageUrl: { type: String },
        },
      ],
      default: undefined,
    },
    /** Every image a move copied, recorded as each lands, so a dead one frees them. */
    copiedUrls: { type: [String], default: undefined },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One batch per request: a retry racing the first attempt is refused here.
ItemBatchSchema.index({ key: 1 }, { unique: true });
// A user's rows, for account deletion.
ItemBatchSchema.index({ user: 1 });
// The daily sweep of everyone's dead moves (WIS-443): unfinished rows, oldest first.
ItemBatchSchema.index({ done: 1, createdAt: 1 });
// Rows go at their `expiresAt` (a day after they were written, a move's a week).
ItemBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IItemBatch {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  key: string;
  wishlist: mongoose.Types.ObjectId;
  payload: string;
  done: boolean;
  result?: { done?: string[]; skipped?: string[]; gone?: string[]; failed?: string[] };
  moves?: Array<{
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    imageUrl?: string;
  }>;
  copiedUrls?: string[];
  expiresAt: Date;
  createdAt: Date;
}

const ItemBatch: Model<IItemBatch> =
  mongoose.models.ItemBatch || mongoose.model<IItemBatch>('ItemBatch', ItemBatchSchema);

export default ItemBatch;
