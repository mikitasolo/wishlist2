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
  // How many events this row stands for. A burst of follows (or of proposals on
  // one list) is coalesced at write time into a single unread row, so it can't
  // push everything else out of the feed. Absent on rows written before
  // coalescing existed, which each stand for one event.
  count?: number;
  // Coalesced follows only: the latest few actors, oldest first (the last one is
  // also `actorUsername`). Never set on a proposal, which carries no actor.
  actorUsernames?: string[];
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
    count: { type: Number, default: 1, min: 1 },
    // No default: a row that never had an actor list (a proposal) has no field.
    actorUsernames: { type: [String], default: undefined },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', default: null },
    wishlistName: { type: String, default: null },
    wishlistSlug: { type: String, default: null },
    itemName: { type: String, default: null },
    read: { type: Boolean, default: false },
    // Immutable, as the timestamps plugin would declare it, except for a query
    // that opts in with `overwriteImmutable: true`: a coalesced row bumps it to
    // the latest event through an upsert (lib/notifications.ts), and Mongoose
    // moves a plainly immutable path out of an upsert's $set whatever the
    // options. The plugin still sets it on insert.
    createdAt: {
      type: Date,
      immutable: (ctx: unknown) =>
        !(ctx instanceof mongoose.Query && ctx.mongooseOptions().overwriteImmutable === true),
    },
  },
  { timestamps: true }
);

// Feed queries (newest first per user) and the unread-count query.
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, read: 1 });

export default (mongoose.models.Notification as mongoose.Model<INotification>) ||
  mongoose.model<INotification>('Notification', NotificationSchema);
