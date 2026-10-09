import mongoose, { type Types } from 'mongoose';
import GroupGift, { type GroupGiftEnding, type IGroupGift } from '@/models/GroupGift';
import Item, { type IItem } from '@/models/Item';
import GiftLog from '@/models/GiftLog';
import Reservation, { type IReservation } from '@/models/Reservation';
import User from '@/models/User';
import type { IWishlist } from '@/models/Wishlist';
import { writeBookingReservation } from '@/lib/utils/bookingReservations';
import {
  deleteReservations,
  releaseSnapshots,
  snapshotReservationImage,
} from '@/lib/utils/reservationSnapshots';
import { giftLogImage } from '@/lib/utils/giftHistory';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';
import { publicDisplayName } from '@/lib/utils/displayName';
import {
  GROUP_GIFT_MAX_CONTRIBUTORS,
  isFunded,
  summarizeGroupGift,
  type GroupGiftSummary,
} from '@/lib/utils/groupGiftSummary';
import { errorKind } from '@/lib/utils/errorKind';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { notifyGroupGiftOrganizer } from '@/lib/groupGiftNotifications';

/**
 * Every write to a group gift (WIS-361, `models/GroupGift.ts`), and keeping its
 * item in step.
 *
 * The gift is the source of truth; the item mirrors it. While the gift is live
 * the item is `booked`, `bookedBy` its organizer and `groupGift` its id, so the
 * booking rules hold as for a solo booking: the organizer can always release it,
 * owners see it as `available`. Each change is one conditional write on the gift
 * (filtered on it still being live, the caller still being the organizer or a
 * contributor), computing what follows from it (the next organizer, `funded` or
 * `open`) inside that same write, so two requests racing can't each act on a
 * state the other has changed. The item then follows through `syncGiftItem`.
 *
 * Releasing a booking anywhere else skips a group gift's item in its own filter
 * (`groupGift: null`): `releaseUserBookings`, `releaseGifterHoldings`,
 * `undoBookingUnlessMember` and a solo unbook. Instead, those paths take the
 * person out of the gift first (`withdrawFromListGroupGifts`), which hands the
 * organizer role on to the earliest remaining contributor, or ends the gift and
 * releases the item when nobody is left.
 */

type Id = string | Types.ObjectId;

/**
 * A member's plain unbook of a group gift's item (`PATCH /api/items/[id]`): the
 * gift is released only through its own actions (leave, or the organizer's
 * cancel or convert), which settle every contributor. Only a member gets it,
 * who sees the gift.
 */
export const GROUP_GIFT_UNBOOK_ERROR = 'This is a group gift: leave it or cancel it instead';

const oid = (id: Id) => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id);

/** Too old to be a start still on its way to booking its item (see `startGroupGift`). */
const STALE_START_MS = 60_000;

/** The pipeline stage that sets `status` from the pledges, for a gift still live. */
const fundedStatus = {
  $cond: [{ $gte: [{ $sum: '$contributors.pledged' }, '$target.value'] }, 'funded', 'open'],
};

/** The fields that end a gift, as an update's `$set` / `$unset`. */
function endingUpdate(endedAs: GroupGiftEnding, endKey?: string) {
  return {
    $set: {
      status: endedAs === 'given' ? 'given' : 'cancelled',
      endedAs,
      endedAt: new Date(),
      ...(endKey && { endKey }),
    },
    $unset: { active: 1 },
    $inc: { rev: 1 },
  };
}

/**
 * Make the item follow its gift, as the gift is now. Safe to call any number of
 * times, from anywhere, in any order:
 *
 *  - live      → `bookedBy` = the organizer, only if the item hasn't followed a
 *                later `rev` already, so a slow call can't put back an older
 *                organizer.
 *  - given or converted → a normal booking of the organizer's: `groupGift` goes,
 *                the item stays booked by them (a gift given stays given).
 *  - cancelled or emptied → the item is released.
 *  - item-ended → nothing: the owner's write already took the item off it.
 *
 * Every write is filtered on the item still holding this gift, so it never
 * touches a booking made after the gift ended.
 */
export async function syncGiftItem(giftId: Id): Promise<void> {
  const gift = await GroupGift.findById(giftId)
    .select('item organizer active rev endedAs')
    .lean<Pick<IGroupGift, '_id' | 'item' | 'organizer' | 'active' | 'rev' | 'endedAs'>>();
  if (!gift) return;
  const held = { _id: gift.item, groupGift: gift._id, status: 'booked' };
  if (gift.active) {
    await Item.updateOne(
      {
        ...held,
        $or: [{ groupGiftRev: { $lt: gift.rev } }, { groupGiftRev: { $exists: false } }],
      },
      { $set: { bookedBy: gift.organizer, groupGiftRev: gift.rev } }
    );
  } else if (gift.endedAs === 'given' || gift.endedAs === 'converted') {
    await Item.updateOne(held, {
      $set: { bookedBy: gift.organizer },
      $unset: { groupGift: 1, groupGiftRev: 1 },
    });
  } else if (gift.endedAs === 'cancelled' || gift.endedAs === 'emptied') {
    await Item.updateOne(held, {
      $set: { status: 'available', bookedBy: null },
      $unset: { groupGift: 1, groupGiftRev: 1 },
    });
  }
}

/** The live gift an item holds, or null. */
export async function liveGiftOf(
  item: Pick<IItem, 'groupGift'>
): Promise<Pick<IGroupGift, '_id' | 'organizer' | 'contributors' | 'target' | 'createdAt'> | null> {
  if (!item.groupGift) return null;
  return GroupGift.findOne({ _id: item.groupGift, active: true })
    .select('organizer contributors target createdAt')
    .lean();
}

export type StartResult =
  { ok: true; gift: Types.ObjectId; item: IItem } | { ok: false; reason: 'not-available' };

/**
 * Start a group gift on an available item: the gift first, then the item's
 * booking, taken only while the item is still `available`. The gift exists
 * before the item names it, so a solo unbook, which is refused on an item with a
 * gift, can never release one; a booking that loses deletes the gift it wrote.
 *
 * One live gift per item (a unique index). One left behind by an owner's change
 * whose clean-up failed is no longer its item's; it's ended here once it's old
 * enough not to be another start on its way to the item.
 */
export async function startGroupGift({
  itemId,
  wishlistId,
  userId,
  pledged,
  target,
  startKey,
}: {
  itemId: Id;
  wishlistId: Id;
  userId: string;
  pledged: number;
  target: { value: number; currency: string };
  startKey?: string;
}): Promise<StartResult> {
  const uid = oid(userId);
  const create = () =>
    GroupGift.create({
      item: itemId,
      wishlist: wishlistId,
      organizer: uid,
      target,
      contributors: [{ user: uid, pledged, joinedAt: new Date() }],
      status: isFunded(pledged, target.value) ? 'funded' : 'open',
      active: true,
      rev: 0,
      ...(startKey && { startKey }),
    });

  let gift;
  try {
    gift = await create();
  } catch (err) {
    if (!isLiveGiftClash(err)) throw err;
    // Another start got there first (or one left behind holds the slot).
    if (!(await endStaleGift(itemId))) return { ok: false, reason: 'not-available' };
    try {
      gift = await create();
    } catch (again) {
      if (isLiveGiftClash(again)) return { ok: false, reason: 'not-available' };
      throw again;
    }
  }

  const booked = await Item.findOneAndUpdate(
    { _id: itemId, wishlist: wishlistId, status: 'available' },
    { $set: { status: 'booked', bookedBy: uid, groupGift: gift._id, groupGiftRev: 0 } },
    { new: true }
  );
  if (!booked) {
    await GroupGift.deleteOne({ _id: gift._id });
    return { ok: false, reason: 'not-available' };
  }
  return { ok: true, gift: gift._id, item: booked };
}

/**
 * Which of a group gift's unique indexes refused a write: the one live gift per
 * item, or a start's idempotency key (`{ item, startKey }`, whose first field
 * is `item` too, so `duplicateKeyField` can't tell them apart).
 */
export function groupGiftClash(err: unknown): 'live' | 'startKey' | null {
  if (!isDuplicateKeyError(err)) return null;
  const pattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
  if ('startKey' in pattern) return 'startKey';
  return 'item' in pattern ? 'live' : null;
}
const isLiveGiftClash = (err: unknown) => groupGiftClash(err) === 'live';

/** End the item's live gift if the item doesn't hold it and it's old enough. True if it did. */
async function endStaleGift(itemId: Id): Promise<boolean> {
  const live = await GroupGift.findOne({ item: itemId, active: true }).select('createdAt').lean();
  if (!live) return true; // ended meanwhile: try again
  if (Date.now() - live.createdAt.getTime() < STALE_START_MS) return false;
  if (await Item.exists({ _id: itemId, groupGift: live._id })) return false;
  const { modifiedCount } = await GroupGift.updateOne(
    { _id: live._id, active: true },
    endingUpdate('item-ended')
  );
  return modifiedCount > 0;
}

export type JoinResult = 'joined' | 'already' | 'full' | 'ended';

/** Add `userId` to a live gift with their pledge, unless they're in it or it's full. */
export async function joinGroupGift(
  giftId: Id,
  userId: string,
  pledged: number
): Promise<JoinResult> {
  const uid = oid(userId);
  const joined = await GroupGift.findOneAndUpdate(
    {
      _id: giftId,
      active: true,
      'contributors.user': { $ne: uid },
      [`contributors.${GROUP_GIFT_MAX_CONTRIBUTORS - 1}`]: { $exists: false },
    },
    [
      {
        $set: {
          contributors: {
            $concatArrays: ['$contributors', [{ user: uid, pledged, joinedAt: new Date() }]],
          },
          rev: { $add: ['$rev', 1] },
        },
      },
      { $set: { status: fundedStatus } },
    ],
    { new: true, lean: true, projection: { _id: 1 } }
  );
  if (joined) return 'joined';
  const gift = await GroupGift.findOne({ _id: giftId, active: true })
    .select('contributors.user')
    .lean();
  if (!gift) return 'ended';
  if (gift.contributors.some((c) => c.user.equals(uid))) return 'already';
  return 'full';
}

/** Set a contributor's pledge on a live gift. False if they're not in it (or it ended). */
export async function changePledge(giftId: Id, userId: string, pledged: number): Promise<boolean> {
  const uid = oid(userId);
  const changed = await GroupGift.findOneAndUpdate(
    { _id: giftId, active: true, 'contributors.user': uid },
    [
      {
        $set: {
          contributors: {
            $map: {
              input: '$contributors',
              in: {
                $cond: [
                  { $eq: ['$$this.user', uid] },
                  { $mergeObjects: ['$$this', { pledged }] },
                  '$$this',
                ],
              },
            },
          },
          rev: { $add: ['$rev', 1] },
        },
      },
      { $set: { status: fundedStatus } },
    ],
    { new: true, lean: true, projection: { _id: 1 } }
  );
  return !!changed;
}

/**
 * Take `userId` out of a live gift, in one write that also settles what follows:
 * an organizer leaving hands the role to the earliest remaining contributor; the
 * last one leaving ends the gift (`emptied`). Returns the gift as it was before,
 * or null when they weren't in a live one. The item then follows
 * (`syncGiftItem`); the caller decides about their Reservation.
 */
export async function withdrawFromGift(
  giftId: Id,
  userId: string
): Promise<Pick<IGroupGift, '_id' | 'organizer' | 'item'> | null> {
  const uid = oid(userId);
  const empty = { $eq: [{ $size: '$contributors' }, 0] };
  const before = await GroupGift.findOneAndUpdate(
    { _id: giftId, active: true, 'contributors.user': uid },
    [
      {
        $set: {
          contributors: {
            $filter: { input: '$contributors', cond: { $ne: ['$$this.user', uid] } },
          },
          rev: { $add: ['$rev', 1] },
        },
      },
      {
        $set: {
          organizer: {
            $cond: [
              { $eq: ['$organizer', uid] },
              { $ifNull: [{ $arrayElemAt: ['$contributors.user', 0] }, '$organizer'] },
              '$organizer',
            ],
          },
          status: { $cond: [empty, 'cancelled', fundedStatus] },
          endedAs: { $cond: [empty, 'emptied', '$$REMOVE'] },
          endedAt: { $cond: [empty, '$$NOW', '$$REMOVE'] },
          active: { $cond: [empty, '$$REMOVE', true] },
        },
      },
    ],
    { new: false, lean: true, projection: { organizer: 1, item: 1 } }
  );
  if (before) await syncGiftItem(giftId);
  // WIS-364: an organizer's leave (of any kind) tells whoever holds it now.
  if (before?.organizer.equals(uid)) await notifyGroupGiftOrganizer(giftId, userId);
  return before;
}

/**
 * Take `userId` out of every live gift on a list, as `withdrawFromGift` does,
 * then bring each item they still hold for a gift up to date with it (one whose
 * follow-up a failure cut short). For every way off a list or into its owners:
 * leave, kick, removal, promotion, account deletion, and a start or join undone
 * because the caller stopped being a member meanwhile. Reservations are the
 * caller's to settle. Returns how many of those gifts they were organizing,
 * i.e. how many items they no longer hold.
 */
export async function withdrawFromListGroupGifts(wishlistId: Id, userId: string): Promise<number> {
  const uid = oid(userId);
  const gifts = await GroupGift.find({
    wishlist: wishlistId,
    active: true,
    'contributors.user': uid,
  })
    .select('_id')
    .lean();
  let organized = 0;
  for (const { _id } of gifts) {
    const before = await withdrawFromGift(_id, userId);
    if (before?.organizer.equals(uid)) organized++;
  }
  const stale = await Item.find({
    wishlist: wishlistId,
    bookedBy: uid,
    status: 'booked',
    groupGift: { $ne: null },
  })
    .select('groupGift')
    .lean();
  for (const { groupGift } of stale) if (groupGift) await syncGiftItem(groupGift);
  return organized;
}

/**
 * Account deletion's step: every live gift the account is still in, on any
 * list (a list's own leave has taken most), then its place in finished ones.
 * A finished gift it organized goes whole (its contributors keep their own
 * `GiftLog`s and reservations); in any other it's taken off the contributors.
 */
export async function eraseGroupGiftsOf(userId: string): Promise<void> {
  const uid = oid(userId);
  const lists: Types.ObjectId[] = await GroupGift.distinct('wishlist', {
    active: true,
    'contributors.user': uid,
  });
  for (const wishlistId of lists) await withdrawFromListGroupGifts(wishlistId, userId);
  await GroupGift.deleteMany({ active: { $ne: true }, organizer: uid });
  await GroupGift.updateMany(
    { active: { $ne: true }, 'contributors.user': uid },
    { $pull: { contributors: { user: uid } } }
  );
}

/**
 * An owner moved the item to draft, marked it received or deleted it: its live
 * gift ends there (`item-ended`), with every contributor's Reservation kept, as
 * an owner's change keeps a solo gifter's so they can still log the gift. The
 * owner's write has already taken the item off the gift.
 */
export async function endGroupGiftsOnItem(itemId: Id): Promise<void> {
  await GroupGift.updateMany({ item: itemId, active: true }, endingUpdate('item-ended'));
}

/**
 * An organizer's ending of their live gift: one conditional write that only
 * matches while it's live and they're its organizer. Returns the gift as ended
 * (its contributors as they were at that moment), or null. The item follows.
 */
export async function endGroupGift(
  giftId: Id,
  organizerId: string,
  endedAs: 'given' | 'converted' | 'cancelled',
  endKey?: string
): Promise<IGroupGift | null> {
  const ended = await GroupGift.findOneAndUpdate(
    { _id: giftId, active: true, organizer: oid(organizerId) },
    endingUpdate(endedAs, endKey),
    { new: true, lean: true }
  );
  if (ended) await syncGiftItem(giftId);
  return ended;
}

/**
 * Whether `userId` should hold a Reservation of the item now: they're a
 * contributor of the live gift it holds, or it's their own booking without a
 * gift (a solo one, or a gift they converted).
 */
export async function holdsItem(userId: string, itemId: Id): Promise<boolean> {
  const item = await Item.findById(itemId).select('status bookedBy groupGift').lean();
  if (!item || item.status !== 'booked') return false;
  if (item.groupGift) {
    return !!(await GroupGift.exists({
      _id: item.groupGift,
      active: true,
      'contributors.user': oid(userId),
    }));
  }
  return item.bookedBy?.toString() === userId;
}

type ReservationWishlist = Pick<IWishlist, '_id' | 'name' | 'owners'>;
type ReservedItem = Pick<IItem, '_id' | 'name' | 'imageUrl' | 'price'>;

/** What a contributor's Reservation write replaced: an earlier booking's, kept on purpose. */
export type PreviousReservation = Pick<
  IReservation,
  'wishlist' | 'owner' | 'itemName' | 'itemImage' | 'itemPrice' | 'wishlistName' | 'pledge'
> | null;

/**
 * A contributor's Reservation of the gift's item, once their place in the gift
 * has landed. A Reservation they kept from an earlier booking of the item (an
 * owner's change keeps it) is replaced, and returned as it was, for
 * `settleContributorReservation` to free its snapshot once the place stands, or
 * `undoContributorReservation` to put it back if it doesn't.
 */
export async function writeContributorReservation(
  userId: string,
  wishlist: ReservationWishlist,
  item: ReservedItem,
  pledge: { value: number; currency: string } | null = null
): Promise<PreviousReservation> {
  return writeBookingReservation(userId, wishlist, item, pledge);
}

/**
 * Whether `userId` is in the live group gift on the item (WIS-363): their
 * Reservation of it is the gift's, which they give with everyone (the
 * organizer's Mark as given) or leave, never log or dismiss on its own.
 */
export async function inLiveGroupGift(userId: string, itemId: Id): Promise<boolean> {
  return !!(await GroupGift.exists({
    item: itemId,
    active: true,
    'contributors.user': oid(userId),
  }));
}

/**
 * Bring a contributor's Reservation's `pledge` (their share, which Mark as
 * given on their Booked page logs, WIS-363) in step with the live gift, after a
 * write to their pledge. Read back from the gift rather than taken from the
 * request, so of two changes racing, the one landing last writes what the gift
 * holds. Only while they're in the live gift: a Reservation outliving their
 * place keeps the share it had.
 */
export async function syncContributorPledge(itemId: Id, userId: string): Promise<void> {
  const uid = oid(userId);
  const gift = await GroupGift.findOne({ item: itemId, active: true, 'contributors.user': uid })
    .select('item target contributors')
    .lean();
  const mine = gift?.contributors.find((c) => c.user.equals(uid));
  if (!gift || !mine) return;
  await Reservation.updateOne(
    { gifter: uid, item: gift.item },
    { $set: { pledge: { value: mine.pledged, currency: gift.target.currency } } }
  );
}

/**
 * The place a Reservation was written for didn't stand (the gift ended, they
 * were taken out of it, or stopped being a member): the Reservation goes, or,
 * with `restore`, the one it replaced is put back as it was, as
 * `undoBookingUnlessMember` does for a booking. Never restored for someone now
 * an owner, who holds no reservation on their own list.
 */
export async function undoContributorReservation(
  userId: string,
  itemId: Id,
  previous: PreviousReservation,
  { restore }: { restore: boolean }
): Promise<void> {
  if (previous && restore) {
    const { wishlist, owner, itemName, itemImage, itemPrice, wishlistName } = previous;
    const pledge = previous.pledge ?? null;
    await Reservation.updateOne(
      { gifter: userId, item: itemId },
      { $set: { wishlist, owner, itemName, itemImage, itemPrice, wishlistName, pledge } }
    );
  } else {
    await deleteReservations({ gifter: userId, item: itemId });
  }
  // Freed unless a record holds it again (the restored one).
  if (previous) await releaseSnapshots(userId, [previous.itemImage]);
}

/** The place stands: free what the write replaced, and copy the item's image for the new one. */
export async function settleContributorReservation(
  userId: string,
  item: ReservedItem,
  previous: PreviousReservation
): Promise<void> {
  if (previous) await releaseSnapshots(userId, [previous.itemImage]);
  await snapshotReservationImage(userId, item._id, item.imageUrl);
}

/**
 * A contributor left the gift: their Reservation goes. If they're back in it
 * meanwhile (their join from another tab landing after), it's written back.
 */
export async function endContributorReservation(
  userId: string,
  wishlist: ReservationWishlist,
  item: ReservedItem
): Promise<void> {
  await deleteReservations({ gifter: userId, item: item._id });
  try {
    if (await holdsItem(userId, item._id)) {
      const previous = await writeContributorReservation(userId, wishlist, item);
      await syncContributorPledge(item._id, userId);
      await settleContributorReservation(userId, item, previous);
    }
  } catch (err) {
    console.error('Re-checking a group gift leave failed:', errorKind(err));
  }
}

/**
 * Marking a group gift as given, once `endGroupGift` has ended it: one `GiftLog`
 * per contributor (their own diary), recording their pledge, written from their
 * Reservation as the gift route writes one, which is taken in the same step. A
 * contributor with no Reservation still gets their entry, without an image,
 * unless they've logged this item themselves since the gift started. The item
 * isn't touched: gifting is decoupled from the live item. A failed entry puts
 * its Reservation back, so they can still log it from their Booked page.
 */
export async function logGivenGroupGift(
  gift: IGroupGift,
  wishlist: ReservationWishlist & { _id: Types.ObjectId },
  itemName: string
): Promise<void> {
  const usernames = new Map<string, string | null>();
  const usernameOf = async (key: string) => {
    if (!usernames.has(key)) {
      const user = await User.findById(key).select('username').lean();
      usernames.set(key, user?.username ?? null);
    }
    return usernames.get(key) ?? null;
  };
  const giftedAt = new Date();
  for (const contributor of gift.contributors) {
    const gifter = contributor.user;
    const reservation = await Reservation.findOneAndDelete({ gifter, item: gift.item }).lean();
    if (
      !reservation &&
      (await GiftLog.exists({ gifter, item: gift.item, giftedAt: { $gte: gift.createdAt } }))
    ) {
      continue;
    }
    try {
      // The recipient as their Reservation pinned it, else the primary owner now.
      const recipient = reservation?.owner?.toString() ?? primaryOwnerId(wishlist);
      const [itemImage, recipientUsername] = await Promise.all([
        reservation ? giftLogImage(gifter.toString(), reservation) : null,
        recipient ? usernameOf(recipient) : null,
      ]);
      await GiftLog.create({
        gifter,
        giftedAt,
        itemName: reservation?.itemName ?? itemName,
        itemImage,
        itemPrice: { value: contributor.pledged, currency: gift.target.currency },
        recipient,
        recipientUsername,
        wishlistName: reservation?.wishlistName ?? wishlist.name,
        wishlist: wishlist._id,
        item: gift.item,
      });
    } catch (err) {
      console.error('Logging a group gift for a contributor failed:', errorKind(err));
      if (reservation) {
        await Reservation.collection
          .insertOne(reservation)
          .catch((e) => console.error('Could not restore a reservation:', errorKind(e)));
      }
    }
  }
}

/**
 * The group-gift summaries for a member's (never an owner's) read of `items`:
 * one per booked item holding a live gift, keyed by item id. Contributors'
 * names are read only for a gift the viewer is in. Best-effort: a failed read
 * is logged and summarizes nothing.
 */
export async function readGroupGiftSummaries(
  viewerId: string,
  items: ReadonlyArray<Pick<IItem, '_id' | 'status' | 'groupGift'>>
): Promise<Map<string, GroupGiftSummary>> {
  try {
    return await summarize(viewerId, items);
  } catch (err) {
    // Best-effort, like `readGivenByViewer`: the item still reads as booked,
    // and the next read has the gift.
    console.error('Reading group gifts failed:', errorKind(err));
    return new Map();
  }
}

async function summarize(
  viewerId: string,
  items: ReadonlyArray<Pick<IItem, '_id' | 'status' | 'groupGift'>>
): Promise<Map<string, GroupGiftSummary>> {
  const held = items.filter((i) => i.status === 'booked' && i.groupGift);
  const summaries = new Map<string, GroupGiftSummary>();
  if (held.length === 0) return summaries;

  const gifts = await GroupGift.find({
    _id: { $in: held.map((i) => i.groupGift) },
    active: true,
  })
    .select('item organizer target contributors')
    .lean();
  const viewer = oid(viewerId);
  const named = new Set<string>();
  for (const g of gifts) {
    if (g.contributors.some((c) => c.user.equals(viewer))) {
      for (const c of g.contributors) named.add(c.user.toString());
    }
  }
  const users = named.size
    ? await User.find({ _id: { $in: [...named] } })
        .select('username name')
        .lean()
    : [];
  const names = new Map(users.map((u) => [u._id.toString(), publicDisplayName(u)]));

  const byId = new Map(gifts.map((g) => [g._id.toString(), g]));
  for (const item of held) {
    const gift = byId.get(item.groupGift!.toString());
    if (!gift || !gift.item.equals(item._id)) continue;
    summaries.set(
      item._id.toString(),
      summarizeGroupGift(
        {
          organizer: gift.organizer.toString(),
          target: gift.target,
          contributors: gift.contributors.map((c) => ({
            user: c.user.toString(),
            pledged: c.pledged,
          })),
        },
        viewerId,
        names
      )
    );
  }
  return summaries;
}

/**
 * As `readGroupGiftSummaries`, for a read where a missing summary would say the
 * wrong thing rather than less (a contributor's Booked page, WIS-363, where a
 * gift's item not booked by them would read as released): a failed read
 * throws, for the caller to fail as a whole.
 */
export function readGroupGiftSummariesOrThrow(
  viewerId: string,
  items: ReadonlyArray<Pick<IItem, '_id' | 'status' | 'groupGift'>>
): Promise<Map<string, GroupGiftSummary>> {
  return summarize(viewerId, items);
}
