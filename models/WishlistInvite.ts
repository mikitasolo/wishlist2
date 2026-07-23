import mongoose, { Schema, Model } from 'mongoose';

/**
 * A pending invitation to join a wishlist. Membership is only created once the
 * invitee accepts (so nobody can be added without consent). An invite may
 * target an existing account (invitedUser) or just an email that has no account
 * yet — matched by email once that person signs up.
 */
const WishlistInviteSchema = new Schema(
  {
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Set when the invitee already has an account.
    invitedUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Always stored (server-side only) so email invites resolve after signup.
    email: { type: String, lowercase: true, trim: true, default: null },
    role: { type: String, enum: ['admin', 'member'], required: true, default: 'member' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      required: true,
      default: 'pending',
    },
  },
  { timestamps: true }
);

WishlistInviteSchema.index({ wishlist: 1, invitedUser: 1, status: 1 });
WishlistInviteSchema.index({ wishlist: 1, email: 1, status: 1 });
WishlistInviteSchema.index({ invitedUser: 1, status: 1 });
WishlistInviteSchema.index({ email: 1, status: 1 });

export interface IWishlistInvite {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  invitedUser?: mongoose.Types.ObjectId | null;
  email?: string | null;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
  updatedAt: Date;
}

const WishlistInvite: Model<IWishlistInvite> =
  mongoose.models.WishlistInvite ||
  mongoose.model<IWishlistInvite>('WishlistInvite', WishlistInviteSchema);

export default WishlistInvite;
