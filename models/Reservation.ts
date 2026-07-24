import mongoose, { Schema, Model } from 'mongoose';

/**
 * A gifter's durable claim on an item they intend to give. It exists
 * independently of the live item: the owner completing, reopening, drafting, or
 * even deleting the item never touches it, and it survives the gifter leaving or
 * being removed from the wishlist. It carries a snapshot taken at reserve time
 * so the gifter can always see what they claimed and log it as a gift, no matter
 * what happened to the source item afterwards.
 *
 * Lifecycle (only the gifter ever removes it):
 *   - created  when the gifter books an available item
 *   - deleted  when the gifter unbooks, marks it gifted (→ a GiftLog entry), or
 *              dismisses it
 */
const ReservationPriceSchema = new Schema(
  { value: { type: Number, required: true }, currency: { type: String, required: true } },
  { _id: false }
);

const ReservationSchema = new Schema(
  {
    gifter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    // The recipient (wishlist owner at reserve time) — used when logging the gift.
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Snapshot at reserve time (frozen — survives item edits/deletion).
    itemName: { type: String, required: true },
    itemImage: { type: String, default: null },
    itemPrice: { type: ReservationPriceSchema, default: null },
    wishlistName: { type: String, required: true },
  },
  { timestamps: true }
);

// One active reservation per gifter+item.
ReservationSchema.index({ gifter: 1, item: 1 }, { unique: true });
ReservationSchema.index({ gifter: 1, createdAt: -1 });

export interface IReservation {
  _id: mongoose.Types.ObjectId;
  gifter: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  item: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  itemName: string;
  itemImage?: string | null;
  itemPrice?: { value: number; currency: string } | null;
  wishlistName: string;
  createdAt: Date;
  updatedAt: Date;
}

const Reservation: Model<IReservation> =
  mongoose.models.Reservation || mongoose.model<IReservation>('Reservation', ReservationSchema);

export default Reservation;
