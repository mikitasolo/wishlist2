import { NextRequest, NextResponse } from 'next/server';
import GroupGift from '@/models/GroupGift';
import { startGroupGiftSchema, validateRequestBody } from '@/lib/validations';
import { hasRate, normalizeCurrency } from '@/lib/utils/currency';
import {
  readIdempotencyKey,
  scopedIdempotencyKey,
  IDEMPOTENCY_HEADER,
} from '@/lib/utils/itemIdempotency';
import {
  groupGiftClash,
  holdsItem,
  settleContributorReservation,
  startGroupGift,
  syncContributorPledge,
  syncGiftItem,
  undoContributorReservation,
  withdrawFromGift,
  writeContributorReservation,
} from '@/lib/utils/groupGifts';
import { lostMemberReason } from '@/lib/utils/lateBooking';
import { notifyGroupGiftFunded } from '@/lib/groupGiftNotifications';
import {
  admitGiftCaller,
  giftError,
  giftItemAnswer,
  lostMembershipResponse,
  GROUP_GIFT_ENDED,
  GROUP_GIFT_NOT_AVAILABLE,
  GROUP_GIFT_TARGET_REQUIRED,
} from '@/lib/utils/groupGiftRoutes';

// POST /api/items/[id]/group-gift — start a group gift (WIS-361) on an available
// item, as a member: the item becomes booked by the caller, its organizer, who
// is the first contributor with `pledged` and holds a Reservation of it like
// any booking. `target` defaults to the item's price (required when it has
// none). An `Idempotency-Key` makes a retry answer as the first attempt did.
//
// Answers 201 with the item as the caller's list read now shows it, its
// `groupGift` summary included.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const caller = await admitGiftCaller(id);
    if (!caller.ok) return caller.response;
    const { userId, item, wishlist, rates } = caller;

    const key = readIdempotencyKey(request.headers);
    if (key === undefined) return giftError(`Invalid ${IDEMPOTENCY_HEADER} header`, 400);
    const startKey = key ? scopedIdempotencyKey(userId, key) : undefined;
    // A retry of a start that landed: answered with the item as it is now.
    if (startKey && (await GroupGift.exists({ item: item._id, startKey }))) {
      return giftItemAnswer(caller, 201);
    }

    const validation = await validateRequestBody(request, startGroupGiftSchema);
    if (!validation.success) return giftError(validation.error, validation.status);
    const { pledged } = validation.data;

    if (item.status !== 'available') return giftError(GROUP_GIFT_NOT_AVAILABLE, 409);

    const sent = validation.data.target;
    const target = sent
      ? { value: sent.value, currency: normalizeCurrency(sent.currency) }
      : item.price && item.price.value > 0
        ? { value: item.price.value, currency: normalizeCurrency(item.price.currency) }
        : null;
    if (!target) return giftError(GROUP_GIFT_TARGET_REQUIRED, 400);
    if (!hasRate(rates, target.currency)) {
      return giftError(
        `Currency '${target.currency}' is not supported. Please use a supported currency code.`,
        400
      );
    }

    let started;
    try {
      started = await startGroupGift({
        itemId: item._id,
        wishlistId: wishlist._id,
        userId,
        pledged,
        target,
        startKey,
      });
    } catch (err) {
      // The same key's first attempt landed meanwhile.
      if (startKey && groupGiftClash(err) === 'startKey') return giftItemAnswer(caller, 201);
      throw err;
    }
    if (!started.ok) return giftError(GROUP_GIFT_NOT_AVAILABLE, 409);

    // Read as a member at the top, and the writes landed later: if they've left,
    // been removed, become an owner or the list was archived meanwhile, the gift
    // is undone (handed on, if someone joined it already) rather than left with
    // an organizer who can't release it. The paths that change the role take
    // them out of gifts too, after their own write, so between the two every
    // order is covered (as for `undoBookingUnlessMember`).
    // Their Reservation carries their share, which Mark as given on their
    // Booked page logs instead of the item's price (WIS-363).
    const previous = await writeContributorReservation(userId, wishlist, started.item, {
      value: pledged,
      currency: target.currency,
    });
    const lost = await lostMemberReason(wishlist._id, userId);
    if (lost) {
      await withdrawFromGift(started.gift, userId);
      // Also when the role change's own withdrawal ended the gift before this
      // start had booked the item: the item follows the gift it now holds.
      await syncGiftItem(started.gift);
      await undoContributorReservation(userId, item._id, previous, { restore: lost !== 'owner' });
      return lostMembershipResponse(lost);
    }
    // Ended meanwhile (the organizer's own cancel from another tab, an owner's
    // change): the Reservation doesn't stand either.
    if (!(await holdsItem(userId, item._id))) {
      await syncGiftItem(started.gift);
      await undoContributorReservation(userId, item._id, previous, { restore: true });
      return giftError(GROUP_GIFT_ENDED, 409);
    }
    // A pledge change from another tab may have landed before the write.
    await syncContributorPledge(item._id, userId);
    await settleContributorReservation(userId, started.item, previous);
    // WIS-364: a gift funded from the start is claimed as told (nobody else is in it).
    await notifyGroupGiftFunded(started.gift, userId);
    return giftItemAnswer(caller, 201);
  } catch (error) {
    console.error('Error starting group gift:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start group gift' },
      { status: 500 }
    );
  }
}
