import mongoose, { Schema, Document } from 'mongoose';
import { OCCASION_KINDS, type OccasionKind } from '@/lib/utils/occasion';
import {
  INVITE_ANSWERS,
  INVITE_ROLES,
  NOTIFICATION_TYPES,
  type InviteAnswer,
  type InviteRole,
  type NotificationType,
} from '@/lib/utils/notifications';

export type { NotificationType };

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  // Recipient of the notification.
  user: mongoose.Types.ObjectId;
  type: NotificationType;
  // Public username of whoever triggered it, snapshotted so rendering needs no
  // extra lookup. NULL on purpose for events where the actor must stay hidden
  // (e.g. a proposal — owners must never learn who proposed an item — or a role
  // change, which never says which owner made it).
  actorUsername?: string | null;
  // Who that is, by account: what the feed reads their avatar and Follow back
  // by, since a username can change hands. Only on the types that show their
  // actor (`showsActor`): follow (the latest follower of a coalesced row),
  // wishlist_invite and invite_accepted. Absent on rows written before it,
  // which then show no face and offer no Follow back.
  actor?: mongoose.Types.ObjectId | null;
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
  // `wishlist_invite` only: how the recipient answered the invite, written with
  // `read: true` in the one write that records it (`recordInviteAnswer`), so
  // the row stops reading as a pending invite. Absent while it's pending.
  inviteAnswer?: InviteAnswer | null;
  // `wishlist_invite` only: the role the invite offers, so an owner invite reads
  // "invited you to co-own …". Absent on rows written before it (WIS-273), which
  // read as a plain invite.
  inviteRole?: InviteRole | null;
  // `occasion_reminder` (and WIS-384's `gift_reminder` / `gift_nudge`): the occasion's kind and the occurrence it's about
  // (a real `YYYY-MM-DD`: a yearly occasion's next one, never its stored
  // year). With `user` and `wishlist` it's what makes a reminder once-only
  // (the unique index below).
  occasionKind?: OccasionKind | null;
  // `birthday_reminder` too (WIS-345): the birthday's next occurrence, with
  // `user` (the friend) and `actor` (whose birthday it is) its once-only key.
  occasionDate?: string | null;
  // `link_join` only (WIS-337): the label of the share link they joined
  // through, snapshotted (owner-written free text; React and the email escape
  // it). Absent for a link without one.
  linkLabel?: string | null;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    actorUsername: { type: String, default: null },
    // No default: a row from before it has no field (see above).
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
    count: { type: Number, default: 1, min: 1 },
    // No default: a row that never had an actor list (a proposal) has no field.
    actorUsernames: { type: [String], default: undefined },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', default: null },
    wishlistName: { type: String, default: null },
    wishlistSlug: { type: String, default: null },
    itemName: { type: String, default: null },
    // No default: only an answered invite has one.
    inviteAnswer: { type: String, enum: INVITE_ANSWERS, default: undefined },
    // No default: only an invite carries one.
    inviteRole: { type: String, enum: INVITE_ROLES, default: undefined },
    // No default: only an occasion reminder carries them.
    occasionKind: { type: String, enum: OCCASION_KINDS, default: undefined },
    occasionDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: undefined },
    // No default: only a link join through a labelled link carries one.
    linkLabel: { type: String, default: undefined },
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
// WIS-364: every feed read looks up the lists of the reader's group gift rows
// (`distinct('wishlist', { user, type })`, to hide those on lists they're no
// longer a plain member of), which this covers without reading their rows.
NotificationSchema.index({ user: 1, type: 1, wishlist: 1 });
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

// One occasion reminder per person per list per occurrence (WIS-193): the
// daily run writes them as upserts on this key, so a re-run, a retry or two
// overlapping runs never remind anyone twice about the same day.
NotificationSchema.index(
  { user: 1, wishlist: 1, occasionDate: 1 },
  { unique: true, partialFilterExpression: { type: 'occasion_reminder' } }
);

// One reminder about what you've reserved per person per list per occurrence
// (WIS-384), before the occasion and after it, each its own key: the daily run
// writes them as upserts (`createGiftReminders`, lib/utils/giftReminders.ts).
// Named: they share the occasion reminder's key pattern, told apart by their
// filters, and the generated name would collide.
NotificationSchema.index(
  { user: 1, wishlist: 1, occasionDate: 1 },
  { unique: true, partialFilterExpression: { type: 'gift_reminder' }, name: 'gift_reminder_once' }
);
NotificationSchema.index(
  { user: 1, wishlist: 1, occasionDate: 1 },
  { unique: true, partialFilterExpression: { type: 'gift_nudge' }, name: 'gift_nudge_once' }
);

// One birthday reminder per friend per person per occurrence (WIS-345): the
// daily run writes them as upserts on this key (`createBirthdayReminders`).
NotificationSchema.index(
  { user: 1, actor: 1, occasionDate: 1 },
  { unique: true, partialFilterExpression: { type: 'birthday_reminder' } }
);

export default (mongoose.models.Notification as mongoose.Model<INotification>) ||
  mongoose.model<INotification>('Notification', NotificationSchema);
