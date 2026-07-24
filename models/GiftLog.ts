import mongoose, { Schema, Model } from 'mongoose';

/**
 * A permanent, self-contained record that a gifter gave a gift — their personal
 * giving diary. Written only when the gifter explicitly marks a reservation as
 * gifted, and never mutated by anyone else: it's a frozen snapshot, so it's
 * unaffected by the owner changing/deleting the item or by the gifter leaving
 * the wishlist. The gifter can delete their own entries to correct mistakes.
 *
 * Note: this is decoupled from the live item on purpose — marking a gift as
 * given does NOT complete the item on the owner's list (that's the owner's call).
 */
const GiftLogPriceSchema = new Schema(
  { value: { type: Number, required: true }, currency: { type: String, required: true } },
  { _id: false }
);

const GiftLogSchema = new Schema(
  {
    gifter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    giftedAt: { type: Date, required: true },
    // Snapshot at gift time (frozen).
    itemName: { type: String, required: true },
    itemImage: { type: String, default: null },
    itemPrice: { type: GiftLogPriceSchema, default: null },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recipientUsername: { type: String, default: null },
    wishlistName: { type: String, default: null },
    // Soft pointers (may dangle if the item/wishlist is later removed).
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', default: null },
    item: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
  },
  { timestamps: true }
);

GiftLogSchema.index({ gifter: 1, giftedAt: -1 });

export interface IGiftLog {
  _id: mongoose.Types.ObjectId;
  gifter: mongoose.Types.ObjectId;
  giftedAt: Date;
  itemName: string;
  itemImage?: string | null;
  itemPrice?: { value: number; currency: string } | null;
  recipient?: mongoose.Types.ObjectId | null;
  recipientUsername?: string | null;
  wishlistName?: string | null;
  wishlist?: mongoose.Types.ObjectId | null;
  item?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const GiftLog: Model<IGiftLog> =
  mongoose.models.GiftLog || mongoose.model<IGiftLog>('GiftLog', GiftLogSchema);

export default GiftLog;
