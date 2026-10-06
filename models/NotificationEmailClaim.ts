import mongoose, { Schema, Model } from 'mongoose';

/**
 * A notification email that's been claimed for sending (WIS-321): the record
 * that keeps an email from going out twice when it must go once, or more often
 * than its limit.
 *
 * - **A proposal to review**: at most one email per list per owner a day. The
 *   row (`kind: 'proposal'`, `key: ''`) is claimed again only once its `sentAt`
 *   is a day old (`claimProposalEmail`).
 * - **Someone joining through a share link** (WIS-337): the same, `kind:
 *   'link_join'`, so a forwarded Join link sends each owner one email a day.
 * - **An occasion reminder**: one email per person, list and occurrence (`kind:
 *   'occasion_reminder'`, `key`: the occurrence's date), so re-runs of the
 *   daily cron and its catch-up days send nothing new.
 * - **A friend's birthday reminder** (WIS-345): one email per friend, person
 *   and occurrence (`kind: 'birthday_reminder'`, no list, `about`: whose
 *   birthday, `key`: `<their id>:<the occurrence's date>`, so the unique index
 *   tells two friends' birthdays on one day apart).
 *
 * A claim is taken before the send, under the unique index, so two requests or
 * runs racing for the same email can't both send it; a failed send gives its
 * claim back. Rows expire a month after their last claim (well past a day, and
 * past the reminders' catch-up window), so the collection stays small. It holds
 * no address and no content, only who was emailed about which list (or whose
 * birthday); an account deletion removes its rows, and those about it
 * (`deleteAccount`).
 */
const CLAIM_KINDS = ['proposal', 'link_join', 'occasion_reminder', 'birthday_reminder'] as const;

const NotificationEmailClaimSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: CLAIM_KINDS, required: true },
  // Every kind but a birthday reminder is about a list.
  wishlist: {
    type: Schema.Types.ObjectId,
    ref: 'Wishlist',
    required(this: { kind?: string }) {
      return this.kind !== 'birthday_reminder';
    },
  },
  // `birthday_reminder` only: whose birthday it was about.
  about: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  key: { type: String, default: '' },
  sentAt: { type: Date, required: true },
});

/** How long a claim row is kept after its last claim. */
export const CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;

// One claim per email: what makes "once" hold under concurrency. The
// collection is new, so autoIndex builds it on an empty collection.
NotificationEmailClaimSchema.index({ user: 1, kind: 1, wishlist: 1, key: 1 }, { unique: true });
// Deleting an account removes the birthday reminder claims about it.
NotificationEmailClaimSchema.index(
  { about: 1 },
  { partialFilterExpression: { kind: 'birthday_reminder' } }
);
NotificationEmailClaimSchema.index({ sentAt: 1 }, { expireAfterSeconds: CLAIM_TTL_SECONDS });

export type NotificationEmailClaimKind = (typeof CLAIM_KINDS)[number];

export interface INotificationEmailClaim {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  kind: NotificationEmailClaimKind;
  wishlist?: mongoose.Types.ObjectId | null;
  about?: mongoose.Types.ObjectId | null;
  key: string;
  sentAt: Date;
}

const NotificationEmailClaim: Model<INotificationEmailClaim> =
  mongoose.models.NotificationEmailClaim ||
  mongoose.model<INotificationEmailClaim>('NotificationEmailClaim', NotificationEmailClaimSchema);

export default NotificationEmailClaim;
