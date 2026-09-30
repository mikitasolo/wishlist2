import mongoose, { Schema, Model } from 'mongoose';

/**
 * A pending invitation to join a wishlist. Membership is only created once the
 * invitee accepts (so nobody can be added without consent). Invites always
 * target an existing account (invitedUser) — you can only invite people who are
 * already registered, which keeps email out of the picture entirely.
 *
 * `role: 'owner'` is how co-ownership is granted, whether the invitee is new to
 * the list or an existing member being promoted. It always needs their consent:
 * ownership puts the list on their public profile and cancels the reservations
 * they hold on it, so it must never be applied by a silent role write.
 */
const WishlistInviteSchema = new Schema(
  {
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], required: true, default: 'member' },
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
WishlistInviteSchema.index({ invitedUser: 1, status: 1 });

// At most one *pending* invite per person per list, so concurrent invites can't
// both land (`issueWishlistInvite` answers the duplicate-key error as "already
// pending"). Partial on purpose: accepting or declining keeps the row and only
// changes `status`, and a full unique index would then block re-inviting someone
// who declined. Environments that predate it are deduped and indexed by the
// `dedupe-pending-invites` migration.
WishlistInviteSchema.index(
  { wishlist: 1, invitedUser: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

export interface IWishlistInvite {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  invitedUser: mongoose.Types.ObjectId;
  role: 'owner' | 'member';
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
  updatedAt: Date;
}

const WishlistInvite: Model<IWishlistInvite> =
  mongoose.models.WishlistInvite ||
  mongoose.model<IWishlistInvite>('WishlistInvite', WishlistInviteSchema);

export default WishlistInvite;
