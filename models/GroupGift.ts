import mongoose, { Schema, Model } from 'mongoose';

/**
 * A group gift (WIS-361): several members of a list splitting one item instead
 * of one of them reserving it whole. Pledges only, on the honor system: no
 * money moves through the app.
 *
 * While it's live (`active`), its item is `booked` with `bookedBy` = the
 * organizer and `Item.groupGift` = this gift's id, so every booking rule holds
 * as for a solo booking: owners see the item as plain `available`, and the
 * organizer is the one holder who can always release it. Each contributor holds
 * their own `Reservation` of the item, so it's on their Booked page.
 *
 * Every write goes through `lib/utils/groupGifts.ts`, as a single conditional
 * write on this document (never a read-then-write), and bumps `rev`, which the
 * item's `groupGiftRev` mirrors so a late item update can't put back an older
 * organizer (`syncGiftItem`).
 *
 *  - `contributors` is in join order: when the organizer goes, the earliest
 *    remaining one takes over (`withdrawFromGift`); with none left the gift
 *    ends and the item is released.
 *  - `status` is `funded` while the pledges reach `target`, `open` below it, and
 *    `given` / `cancelled` once it has ended (`endedAs` says how).
 *  - Never shown to an owner or to anyone off the list: only a member's item
 *    answer carries it (`serializeItem`), as `GroupGiftSummary`.
 */
const MoneySchema = new Schema(
  {
    // Integer cents, like every price.
    value: { type: Number, required: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
  },
  { _id: false }
);

const ContributorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Integer cents, in the target's currency.
    pledged: { type: Number, required: true },
    joinedAt: { type: Date, required: true },
  },
  { _id: false }
);

export const GROUP_GIFT_STATUSES = ['open', 'funded', 'given', 'cancelled'] as const;
export type GroupGiftStatus = (typeof GROUP_GIFT_STATUSES)[number];

/**
 * How a gift that's no longer live ended:
 *  - given      → the organizer marked it as given (a `GiftLog` per contributor).
 *  - converted  → the organizer took it on alone (a normal booking of theirs).
 *  - cancelled  → the organizer cancelled it (item released).
 *  - emptied    → its last contributor left (item released).
 *  - item-ended → an owner moved the item to draft, marked it received or
 *                 deleted it, or deleted the list (reservations kept, as for a
 *                 solo booking).
 *  - list-archived → an owner archived the list (WIS-363): item released,
 *                 reservations kept, as for item-ended; unarchiving doesn't
 *                 bring it back.
 */
export const GROUP_GIFT_ENDINGS = [
  'given',
  'converted',
  'cancelled',
  'emptied',
  'item-ended',
  'list-archived',
] as const;
export type GroupGiftEnding = (typeof GROUP_GIFT_ENDINGS)[number];

const GroupGiftSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: MoneySchema, required: true },
    contributors: { type: [ContributorSchema], default: [] },
    status: { type: String, enum: GROUP_GIFT_STATUSES, required: true, default: 'open' },
    // `true` while open or funded, removed once it ends: the unique index below
    // allows one live gift per item.
    active: { type: Boolean, default: undefined },
    // Bumped by every write (see `syncGiftItem`).
    rev: { type: Number, required: true, default: 0 },
    endedAs: { type: String, enum: GROUP_GIFT_ENDINGS, default: undefined },
    endedAt: { type: Date, default: undefined },
    // The idempotency keys of the request that started it and of the organizer
    // action that ended it, scoped to their sender (`scopedIdempotencyKey`), so
    // a retry is answered as the first attempt was. Never read back.
    startKey: { type: String, select: false, default: undefined },
    endKey: { type: String, select: false, default: undefined },
    // WIS-364: when its contributors were told it's fully funded, claimed once
    // by a conditional write (`notifyGroupGiftFunded`). Absent until then.
    fundedNotifiedAt: { type: Date, default: undefined },
  },
  { timestamps: true }
);

GroupGiftSchema.index({ item: 1 }, { unique: true, partialFilterExpression: { active: true } });
GroupGiftSchema.index({ wishlist: 1, 'contributors.user': 1 });
GroupGiftSchema.index({ 'contributors.user': 1 });
GroupGiftSchema.index({ organizer: 1 });
GroupGiftSchema.index(
  { item: 1, startKey: 1 },
  { unique: true, partialFilterExpression: { startKey: { $exists: true } } }
);
GroupGiftSchema.index(
  { item: 1, endKey: 1 },
  { partialFilterExpression: { endKey: { $exists: true } } }
);

export interface IGroupGiftContributor {
  user: mongoose.Types.ObjectId;
  pledged: number;
  joinedAt: Date;
}

export interface IGroupGift {
  _id: mongoose.Types.ObjectId;
  item: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  organizer: mongoose.Types.ObjectId;
  target: { value: number; currency: string };
  contributors: IGroupGiftContributor[];
  status: GroupGiftStatus;
  active?: boolean;
  rev: number;
  endedAs?: GroupGiftEnding;
  endedAt?: Date;
  startKey?: string;
  endKey?: string;
  fundedNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GroupGift: Model<IGroupGift> =
  mongoose.models.GroupGift || mongoose.model<IGroupGift>('GroupGift', GroupGiftSchema);

export default GroupGift;
