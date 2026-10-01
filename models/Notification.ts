import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  'follow' | 'wishlist_invite' | 'invite_accepted' | 'proposal' | 'proposal_approved';

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  // Recipient of the notification.
  user: mongoose.Types.ObjectId;
  type: NotificationType;
  // Public username of whoever triggered it, snapshotted so rendering needs no
  // extra lookup. NULL on purpose for events where the actor must stay hidden
  // (e.g. a proposal — owners must never learn who proposed an item).
  actorUsername?: string | null;
  // Optional context, snapshotted for cheap, privacy-safe rendering.
  wishlist?: mongoose.Types.ObjectId | null;
  wishlistName?: string | null;
  wishlistSlug?: string | null;
  itemName?: string | null;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['follow', 'wishlist_invite', 'invite_accepted', 'proposal', 'proposal_approved'],
      required: true,
    },
    actorUsername: { type: String, default: null },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', default: null },
    wishlistName: { type: String, default: null },
    wishlistSlug: { type: String, default: null },
    itemName: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Feed queries (newest first per user) and the unread-count query.
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, read: 1 });
// Deleting a wishlist clears its notifications (`deleteMany({ wishlist })` in
// DELETE /api/wishlists/[id]), which without this is a full collection scan.
// Partial, so notifications that carry no list (follows) stay out of it. The
// filter has to keep those out *and* let the planner use the index for that
// delete, and the two obvious ones each manage only one:
//  - `$exists: true` keeps nothing out: `wishlist` defaults to null, so every
//    notification has the field.
//  - `$type: 'objectId'` keeps the nulls out, but the query planner can't tell
//    that `{ wishlist: <id> }` falls inside it, so the delete never uses it.
// `$gte` the lowest ObjectId does both: a comparison only matches values of
// its own type, so this is "any ObjectId", and the planner can prove an
// equality on an id satisfies it.
NotificationSchema.index(
  { wishlist: 1 },
  {
    partialFilterExpression: {
      wishlist: { $gte: new mongoose.Types.ObjectId('000000000000000000000000') },
    },
  }
);

export default (mongoose.models.Notification as mongoose.Model<INotification>) ||
  mongoose.model<INotification>('Notification', NotificationSchema);
