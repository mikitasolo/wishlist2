import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { enforce, userKey } from '@/lib/rateLimit';
import Item, { type IItem } from '@/models/Item';
import User from '@/models/User';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import type { HydratedDocument } from 'mongoose';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { readGivenByViewer, serializeItem } from '@/lib/utils/itemSerializer';
import { readItemRefs } from '@/lib/utils/itemLinkWrites';
import {
  endGroupGift,
  liveGiftOf,
  logGivenGroupGift,
  readGroupGiftSummaries,
} from '@/lib/utils/groupGifts';
import GroupGift from '@/models/GroupGift';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';
import {
  IDEMPOTENCY_HEADER,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';
import type { LostBookingReason } from '@/lib/utils/lateBooking';

/**
 * What the group gift routes (`app/api/items/[id]/group-gift/**`, WIS-361)
 * share: who may call them, and the answer they give.
 */

/**
 * Owners take no part in a group gift, as they can't reserve. Answered before
 * anything about the item's gift is read, the same whatever its state, so it
 * never tells a booking-blind owner the item is reserved or split.
 */
export const GROUP_GIFT_OWNER_ERROR = 'Owners can’t take part in a group gift';
export const GROUP_GIFT_NOT_AVAILABLE = 'This item is no longer available to reserve';
export const GROUP_GIFT_NONE = 'This item has no group gift';
export const GROUP_GIFT_NOT_IN = 'You’re not part of this group gift';
export const GROUP_GIFT_ORGANIZER_ONLY = 'Only the organizer can do that';
export const GROUP_GIFT_FULL = 'This group gift is full';
export const GROUP_GIFT_ENDED = 'This group gift has ended';
export const GROUP_GIFT_TARGET_REQUIRED = 'Set a target for a group gift on an item with no price';

export const giftError = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

export type GiftCaller = {
  userId: string;
  item: HydratedDocument<IItem>;
  wishlist: HydratedDocument<IWishlist>;
  rates: Map<string, number>;
};

/**
 * Admit the caller as booking admits them (`PATCH /api/items/[id]`): signed in,
 * a member of the item's list who isn't an owner, on a list that isn't archived,
 * on an item they may see; then the booking rate limit, with the new-account
 * tier. Every refusal is decided before the item's gift is read.
 */
export async function admitGiftCaller(
  id: string
): Promise<{ ok: false; response: NextResponse } | ({ ok: true } & GiftCaller)> {
  const session: Session | null = await auth();
  if (!session?.user) {
    return { ok: false, response: giftError('Unauthorized - Please sign in', 401) };
  }
  await connectDB();
  const userId = session.user.id;
  if (!(await User.exists({ _id: userId }))) {
    return { ok: false, response: giftError('User not found', 403) };
  }

  const notFound = { ok: false as const, response: giftError('Item not found', 404) };
  const item = isObjectIdParam(id) ? await Item.findById(id) : null;
  if (!item) return notFound;
  const wishlist = await Wishlist.findById(item.wishlist);
  if (!wishlist) return notFound;
  // Archived lists are their owners' alone: answered like a missing item.
  if (isHiddenByArchive(wishlist, userId)) return notFound;
  if (isWishlistOwner(wishlist, userId)) {
    return { ok: false, response: giftError(GROUP_GIFT_OWNER_ERROR, 400) };
  }
  if (!(await WishlistMember.exists({ wishlist: wishlist._id, user: userId }))) {
    return {
      ok: false,
      response: giftError('Unauthorized - No access to this wishlist', 403),
    };
  }
  // A draft is the owners' alone, and a proposal can't be reserved.
  if (item.status === 'draft' || item.status === 'proposed') return notFound;

  const limited = await enforce('booking', userKey(userId), {
    newAccount: session.user.newAccount,
  });
  if (limited) return { ok: false, response: limited };

  const currencyRate = await ensureCurrencyRatesUpToDate();
  const rates = currencyRate?.rates || new Map<string, number>();
  return { ok: true, userId, item, wishlist, rates };
}

/**
 * The answer to a start or join undone because the caller stopped being a plain
 * member while it was in flight: the one they'd have got had that change landed
 * before the request.
 */
export function lostMembershipResponse(reason: LostBookingReason) {
  if (reason === 'not-member') return giftError('Unauthorized - No access to this wishlist', 403);
  if (reason === 'owner') return giftError(GROUP_GIFT_OWNER_ERROR, 400);
  return giftError('Item not found', 404);
}

/**
 * A successful action's answer: the item as the caller's own read of the list
 * would show it now (`serializeItem`, member), group gift summary included.
 */
export async function giftItemAnswer(caller: GiftCaller, status = 200) {
  const item = await Item.findById(caller.item._id);
  if (!item) return giftError('Item not found', 404);
  const [givenByViewer, groupGifts, related] = await Promise.all([
    readGivenByViewer(caller.userId, [item]),
    readGroupGiftSummaries(caller.userId, [item]),
    readItemRefs(item, false),
  ]);
  const data = serializeItem(
    item,
    { role: 'member', id: caller.userId, givenByViewer, groupGifts },
    caller.rates,
    related
  );
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * The organizer's ending of the item's live gift (cancel, convert to solo, mark
 * as given): one conditional write that matches only while the gift is live and
 * the caller its organizer, then what follows from it, on the contributors as
 * the write left them, so a join landing first is included and one landing
 * after is refused. An `Idempotency-Key` makes a retry answer as the first
 * attempt did.
 *
 *  - cancelled → the item is released, every contributor's Reservation goes.
 *  - converted → the organizer keeps the item as a normal booking (and their
 *                Reservation); everyone else's Reservation goes.
 *  - given     → a `GiftLog` per contributor with their pledge, reservations
 *                taken into them; the owner's item untouched, still booked by
 *                the organizer (a gift given stays given on the list).
 */
export async function organizerAction(
  request: Request,
  id: string,
  endedAs: 'cancelled' | 'converted' | 'given'
): Promise<NextResponse> {
  const caller = await admitGiftCaller(id);
  if (!caller.ok) return caller.response;
  const { userId, item, wishlist } = caller;

  const key = readIdempotencyKey(request.headers);
  if (key === undefined) return giftError(`Invalid ${IDEMPOTENCY_HEADER} header`, 400);
  const endKey = key ? scopedIdempotencyKey(userId, key) : undefined;
  if (endKey && (await GroupGift.exists({ item: item._id, endKey }))) {
    return giftItemAnswer(caller);
  }

  const gift = await liveGiftOf(item);
  if (!gift) return giftError(GROUP_GIFT_NONE, 409);
  if (!gift.organizer.equals(userId)) {
    const contributing = gift.contributors.some((c) => c.user.equals(userId));
    return contributing
      ? giftError(GROUP_GIFT_ORGANIZER_ONLY, 403)
      : giftError(GROUP_GIFT_NOT_IN, 403);
  }

  const ended = await endGroupGift(gift._id, userId, endedAs, endKey);
  if (!ended) {
    // Ended meanwhile, or handed on: either way no longer theirs to end.
    return giftError(GROUP_GIFT_ENDED, 409);
  }

  const contributors = ended.contributors.map((c) => c.user);
  if (endedAs === 'cancelled') {
    await deleteReservations({ item: item._id, gifter: { $in: contributors } });
  } else if (endedAs === 'converted') {
    const others = contributors.filter((u) => !u.equals(userId));
    if (others.length) await deleteReservations({ item: item._id, gifter: { $in: others } });
  } else {
    await logGivenGroupGift(ended, wishlist, item.name);
  }
  return giftItemAnswer(caller);
}
