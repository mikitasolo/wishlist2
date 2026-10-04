import mongoose, { Schema, Model } from 'mongoose';

/**
 * A visitor's request to be invited to a wishlist (WIS-275): someone signed in
 * who can open the list but isn't on it asked its owners to invite them.
 *
 * A request grants nothing. An owner answers it with **Invite**, which issues a
 * normal `member` invite (`issueWishlistInvite`) and deletes the request, and
 * the requester joins only by accepting that invite; or with **Decline**, which
 * keeps the row as `declined` and tells nobody. So no request, pending or
 * answered, can ever put anyone on a list by itself.
 *
 * A declined row holds the requester off for `ASK_AGAIN_AFTER_MS`
 * (`lib/utils/joinRequests.ts`): until then their page still reads "Requested",
 * so a decline stays silent, and asking again only sets `withdrawn` back to
 * false without telling anyone. `withdrawn` is the requester's own cancel of a
 * request that, unknown to them, was already declined.
 */
const WishlistJoinRequestSchema = new Schema(
  {
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'declined'],
      required: true,
      default: 'pending',
    },
    // `declined` only: when, which starts the wait before they may ask again.
    declinedAt: { type: Date },
    // `declined` only: the requester cancelled it (not knowing it was declined).
    withdrawn: { type: Boolean },
  },
  { timestamps: true }
);

// The owners' Requests list, oldest first, and a person's rows on a list.
WishlistJoinRequestSchema.index({ wishlist: 1, status: 1, createdAt: 1 });
WishlistJoinRequestSchema.index({ wishlist: 1, user: 1, status: 1 });
// A person's requests across lists (an account's cleanup).
WishlistJoinRequestSchema.index({ user: 1 });

// At most one *pending* request per person per list, so two asks at once can't
// both land (and notify the owners twice). Partial, as the invites' is: a
// declined row is kept for the wait before asking again. The collection is new,
// so Mongoose's autoIndex builds it on an empty collection and no migration is
// needed.
WishlistJoinRequestSchema.index(
  { wishlist: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

export interface IWishlistJoinRequest {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  status: 'pending' | 'declined';
  declinedAt?: Date;
  withdrawn?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WishlistJoinRequest: Model<IWishlistJoinRequest> =
  mongoose.models.WishlistJoinRequest ||
  mongoose.model<IWishlistJoinRequest>('WishlistJoinRequest', WishlistJoinRequestSchema);

export default WishlistJoinRequest;
