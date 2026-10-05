import mongoose, { Schema, Model } from 'mongoose';

/**
 * A notification email that's been claimed for sending (WIS-321): the record
 * that keeps an email from going out twice when it must go once, or more often
 * than its limit.
 *
 * - **A proposal to review**: at most one email per list per owner a day. The
 *   row (`kind: 'proposal'`, `key: ''`) is claimed again only once its `sentAt`
 *   is a day old (`claimProposalEmail`).
 * - **An occasion reminder**: one email per person, list and occurrence (`kind:
 *   'occasion_reminder'`, `key`: the occurrence's date), so re-runs of the
 *   daily cron and its catch-up days send nothing new.
 *
 * A claim is taken before the send, under the unique index, so two requests or
 * runs racing for the same email can't both send it; a failed send gives its
 * claim back. Rows expire a month after their last claim (well past a day, and
 * past the reminders' catch-up window), so the collection stays small. It holds
 * no address and no content, only who was emailed about which list; an account
 * deletion removes its rows (`deleteAccount`).
 */
const NotificationEmailClaimSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['proposal', 'occasion_reminder'], required: true },
  wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
  key: { type: String, default: '' },
  sentAt: { type: Date, required: true },
});

/** How long a claim row is kept after its last claim. */
export const CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;

// One claim per email: what makes "once" hold under concurrency. The
// collection is new, so autoIndex builds it on an empty collection.
NotificationEmailClaimSchema.index({ user: 1, kind: 1, wishlist: 1, key: 1 }, { unique: true });
NotificationEmailClaimSchema.index({ sentAt: 1 }, { expireAfterSeconds: CLAIM_TTL_SECONDS });

export type NotificationEmailClaimKind = 'proposal' | 'occasion_reminder';

export interface INotificationEmailClaim {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  kind: NotificationEmailClaimKind;
  wishlist: mongoose.Types.ObjectId;
  key: string;
  sentAt: Date;
}

const NotificationEmailClaim: Model<INotificationEmailClaim> =
  mongoose.models.NotificationEmailClaim ||
  mongoose.model<INotificationEmailClaim>('NotificationEmailClaim', NotificationEmailClaimSchema);

export default NotificationEmailClaim;
