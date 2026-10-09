import { NextRequest, NextResponse } from 'next/server';
import { pledgeGroupGiftSchema, validateRequestBody } from '@/lib/validations';
import {
  changePledge,
  endContributorReservation,
  holdsItem,
  joinGroupGift,
  liveGiftOf,
  settleContributorReservation,
  syncContributorPledge,
  undoContributorReservation,
  withdrawFromGift,
  writeContributorReservation,
} from '@/lib/utils/groupGifts';
import { lostMemberReason } from '@/lib/utils/lateBooking';
import { notifyGroupGiftFunded, notifyGroupGiftJoined } from '@/lib/groupGiftNotifications';
import {
  admitGiftCaller,
  giftError,
  giftItemAnswer,
  lostMembershipResponse,
  GROUP_GIFT_ENDED,
  GROUP_GIFT_FULL,
  GROUP_GIFT_NONE,
  GROUP_GIFT_NOT_IN,
} from '@/lib/utils/groupGiftRoutes';

// PUT /api/items/[id]/group-gift/me — join the item's group gift (WIS-361) with
// `pledged`, or change your pledge if you're in it already. Joining gives you
// your own Reservation of the item. Idempotent: the same pledge sent again
// changes nothing. Answers with the item as your list read shows it.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const caller = await admitGiftCaller(id);
    if (!caller.ok) return caller.response;
    const { userId, item, wishlist } = caller;

    const validation = await validateRequestBody(request, pledgeGroupGiftSchema);
    if (!validation.success) return giftError(validation.error, validation.status);
    const { pledged } = validation.data;

    const gift = await liveGiftOf(item);
    if (!gift) return giftError(GROUP_GIFT_NONE, 409);

    if (gift.contributors.some((c) => c.user.toString() === userId)) {
      if (!(await changePledge(gift._id, userId, pledged))) return giftError(GROUP_GIFT_ENDED, 409);
      await syncContributorPledge(item._id, userId);
      await notifyGroupGiftFunded(gift._id, userId);
      return giftItemAnswer(caller);
    }

    const joined = await joinGroupGift(gift._id, userId, pledged);
    if (joined === 'ended') return giftError(GROUP_GIFT_ENDED, 409);
    if (joined === 'full') return giftError(GROUP_GIFT_FULL, 409);
    if (joined === 'already') {
      // Their join from another tab landed first: this one sets the pledge.
      if (!(await changePledge(gift._id, userId, pledged))) return giftError(GROUP_GIFT_ENDED, 409);
      await syncContributorPledge(item._id, userId);
      await notifyGroupGiftFunded(gift._id, userId);
      return giftItemAnswer(caller);
    }

    // As a start: the Reservation, then whether they're still a plain member. A
    // join landing after they left, were removed, became an owner or the list
    // was archived is taken back; the role change's own withdrawal covers one
    // that landed before it.
    // Their Reservation carries their share, which Mark as given on their
    // Booked page logs instead of the item's price (WIS-363).
    const previous = await writeContributorReservation(userId, wishlist, item, {
      value: pledged,
      currency: gift.target.currency,
    });
    const lost = await lostMemberReason(wishlist._id, userId);
    if (lost) {
      await withdrawFromGift(gift._id, userId);
      await undoContributorReservation(userId, item._id, previous, { restore: lost !== 'owner' });
      return lostMembershipResponse(lost);
    }
    // The gift ended, or they were taken out of it, meanwhile (a cancel, convert
    // or give crossing the join): no Reservation of this join stands.
    if (!(await holdsItem(userId, item._id))) {
      await undoContributorReservation(userId, item._id, previous, { restore: true });
      return giftError(GROUP_GIFT_ENDED, 409);
    }
    // A pledge change from another tab may have landed before the write.
    await syncContributorPledge(item._id, userId);
    await settleContributorReservation(userId, item, previous);
    // WIS-364: only once the join stands.
    await Promise.all([
      notifyGroupGiftJoined(gift._id, userId),
      notifyGroupGiftFunded(gift._id, userId),
    ]);
    return giftItemAnswer(caller);
  } catch (error) {
    console.error('Error joining group gift:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to join group gift' },
      { status: 500 }
    );
  }
}

// DELETE /api/items/[id]/group-gift/me — leave the item's group gift. Your
// Reservation of it goes. An organizer leaving hands the gift to the earliest
// remaining contributor (who then holds the item); the last one leaving ends it
// and releases the item.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const caller = await admitGiftCaller(id);
    if (!caller.ok) return caller.response;
    const { userId, item, wishlist } = caller;

    if (!item.groupGift) return giftError(GROUP_GIFT_NONE, 409);
    const left = await withdrawFromGift(item.groupGift, userId);
    if (!left) return giftError(GROUP_GIFT_NOT_IN, 409);
    await endContributorReservation(userId, wishlist, item);
    return giftItemAnswer(caller);
  } catch (error) {
    console.error('Error leaving group gift:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to leave group gift' },
      { status: 500 }
    );
  }
}
