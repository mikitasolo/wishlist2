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
 *
 * Any deletion but marking the gift goes through `deleteReservations`
 * (`lib/utils/reservationSnapshots.ts`), which frees the snapshot image too.
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
    // Our own copy of the item's image (`snapshotBlob`), so it survives the owner
    // freeing the item's blob. An external URL is stored as-is.
    itemImage: { type: String, default: null },
    itemPrice: { type: ReservationPriceSchema, default: null },
    wishlistName: { type: String, required: true },
    // A group gift contributor's own share (WIS-363), in cents of the gift's
    // target currency: what Mark as given logs instead of the item's price.
    // Kept in step with their pledge while the gift is live, and kept as it was
    // once they're out of it (left the list, the owner ended the item), so the
    // gift can still be logged with their share. `null` for a solo booking.
    pledge: { type: ReservationPriceSchema, default: null },
  },
  { timestamps: true }
);

// One active reservation per gifter+item.
ReservationSchema.index({ gifter: 1, item: 1 }, { unique: true });
ReservationSchema.index({ gifter: 1, createdAt: -1 });
// WIS-384: the daily gift reminders read a due list's reservations by list.
ReservationSchema.index({ wishlist: 1, gifter: 1 });

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
  pledge?: { value: number; currency: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const Reservation: Model<IReservation> =
  mongoose.models.Reservation || mongoose.model<IReservation>('Reservation', ReservationSchema);

export default Reservation;
