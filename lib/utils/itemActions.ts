import type mongoose from 'mongoose';
import Item, { type IItem } from '@/models/Item';
import type { IWishlist } from '@/models/Wishlist';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { hasRate } from '@/lib/utils/currency';
import {
  readGivenByViewer,
  serializeItem,
  type ItemViewer,
  type SerializedItem,
} from '@/lib/utils/itemSerializer';
import {
  checkItemLinks,
  readItemRefs,
  unlinkDeletedItem,
  writeItemLinks,
} from '@/lib/utils/itemLinkWrites';
import type { LinkChanges } from '@/lib/utils/itemLinks';
import { deleteOwnBlob, freeReplacedImage } from '@/lib/utils/blob';
import {
  cancelUnbookedReservation,
  settleBookingReservation,
  writeBookingReservation,
} from '@/lib/utils/bookingReservations';
import { createNotification } from '@/lib/notifications';
import { undoBookingUnlessMember, type LostBookingReason } from '@/lib/utils/lateBooking';
import { endGroupGiftsOnItem, readGroupGiftSummaries } from '@/lib/utils/groupGifts';
import { errorKind } from '@/lib/utils/errorKind';
import { isCountedOnShareCard } from '@/lib/og/data';
import { purgeShareCards } from '@/lib/og/purge';
import {
  EXPECTED_PROPOSAL,
  PROPOSAL_EDITED_ERROR,
  PROPOSAL_REVIEWED_ERROR,
} from '@/lib/utils/proposalReview';
import {
  OWNER_STATUS_ERROR,
  planItemUpdate,
  type ItemActionFailure,
  type ItemActor,
  type ItemWriteGuard,
  type UpdateItemInput,
} from '@/lib/utils/itemUpdatePlan';

/**
 * The item actions behind `PATCH` / `DELETE /api/items/[id]` (WIS-373): edit,
 * review a proposal, publish / draft / mark as received, reserve, release,
 * delete and withdraw. The route authenticates the caller, reads the item and
 * its list, decides who the caller is on it (and refuses anyone with no
 * access), rate-limits and parses the body; these make the writes, in order,
 * each under the condition it was decided on, and shape every item they answer
 * with `serializeItem`.
 */

export type { ItemActionFailure };
export type UpdateItemResult = { ok: true; data: SerializedItem } | ItemActionFailure;
export type DeleteItemResult = { ok: true } | ItemActionFailure;

/** The list an item is on, as the route read it. */
export type ItemActionWishlist = Pick<IWishlist, '_id' | 'name' | 'owners' | 'slug'>;

const itemNotFound = (): ItemActionFailure => ({ ok: false, status: 404, error: 'Item not found' });

/**
 * The answer to a booking undone because the caller stopped being a plain member
 * while it was in flight (see `undoBookingUnlessMember`): the one they'd have got
 * had that change landed before the request.
 */
function lostBookingFailure(reason: LostBookingReason): ItemActionFailure {
  if (reason === 'not-member') {
    return { ok: false, status: 403, error: 'Unauthorized - No access to this wishlist' };
  }
  if (reason === 'owner') {
    return { ok: false, status: 400, error: OWNER_STATUS_ERROR };
  }
  // The list was archived, which hides it from everyone but its owners.
  return itemNotFound();
}

/**
 * The answer to an item write or delete that matched nothing. With a guard, an
 * item that's still there changed since it was read: 409, with the guard's
 * conflict. Otherwise the item has gone: 404.
 */
async function unmatchedItemFailure(
  id: string,
  guard: ItemWriteGuard | null
): Promise<ItemActionFailure> {
  if (guard && (await Item.exists({ _id: id }))) {
    return { ok: false, status: 409, error: guard.conflict };
  }
  return itemNotFound();
}

/**
 * End the group gifts of an item an owner's write has just taken off them
 * (draft, received or deleted). Best-effort, as the owner's change has landed:
 * a gift left live is no longer its item's, shows nowhere, and is ended by the
 * next start on the item (`startGroupGift`).
 */
async function endItemGroupGifts(itemId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await endGroupGiftsOnItem(itemId);
  } catch (err) {
    console.error('Ending the group gift of an item failed:', errorKind(err));
  }
}

/**
 * Apply a validated edit to an item. Members reserve and release (only their
 * own reservations); owners edit content and publish / draft / mark as
 * received, never reserve; a proposer edits their own proposal, and owners
 * review it. An edit never changes an item's status: only an explicit status
 * change does.
 */
export async function updateItem({
  item: currentItem,
  wishlist,
  actor,
  data: validatedData,
}: {
  /** The item as read at the top of the request. */
  item: IItem;
  wishlist: ItemActionWishlist;
  /**
   * The caller, as decided on the list as read: `isOwner` with
   * `isWishlistOwner`, `isMember` from their `WishlistMember` row. Trusted, so
   * anyone with none of the three must already have been refused.
   */
  actor: ItemActor & { isMember: boolean };
  data: UpdateItemInput;
}): Promise<UpdateItemResult> {
  const { userId, isOwner, isMember } = actor;
  const id = currentItem._id.toString();

  // The review dialog's approve expects a proposal (WIS-199): one that's been
  // approved since the dialog opened, by a co-owner or in another tab, isn't
  // the item it reviewed, and writing the dialog's form over it would replace
  // that review (and unassign a booking made since). Refused whatever the item
  // is now, with one answer that never says it's reserved.
  const expectsProposal = validatedData.expectedStatus === EXPECTED_PROPOSAL;
  if (expectsProposal && currentItem.status !== 'proposed') {
    return { ok: false, status: 409, error: PROPOSAL_REVIEWED_ERROR };
  }

  // Ensure currency rates are up to date for validation
  const currencyRate = await ensureCurrencyRatesUpToDate();
  const rates = currencyRate?.rates || new Map<string, number>();

  // An owner's approve also expects the version of the proposal its dialog
  // shows (WIS-320). A proposer's edit landing since leaves it a proposal, so
  // the check above lets it through, and the approval would put fields on the
  // list that the owner never saw. Refused with the proposal as it is now,
  // shaped for an owner (anonymous, no booking), so the dialog can refill.
  const expectedVersion =
    isOwner && expectsProposal && validatedData.expectedUpdatedAt
      ? new Date(validatedData.expectedUpdatedAt)
      : null;
  const editedFailure = (edited: IItem): ItemActionFailure => ({
    ok: false,
    status: 409,
    error: PROPOSAL_EDITED_ERROR,
    // A proposal goes with nothing (WIS-29).
    data: serializeItem(edited, { role: 'owner' }, rates, []),
  });
  if (expectedVersion && currentItem.updatedAt.getTime() !== expectedVersion.getTime()) {
    return editedFailure(currentItem);
  }

  // Linking (WIS-29) is the owners' alone, on an item that isn't a proposal,
  // to items on the same list, within the cap on both sides. Checked before
  // anything is written, so a refused link leaves the item as it was.
  let linkChanges: LinkChanges = {};
  if (validatedData.linkItems !== undefined || validatedData.unlinkItems !== undefined) {
    if (!isOwner) {
      return { ok: false, status: 403, error: 'Only owners can link items' };
    }
    const checked = await checkItemLinks(wishlist._id.toString(), currentItem, {
      linkItems: validatedData.linkItems,
      unlinkItems: validatedData.unlinkItems,
    });
    if (!checked.ok) {
      return { ok: false, status: checked.status, error: checked.error };
    }
    linkChanges = checked.changes;
  }

  // Validate currency exists in rates if price is being updated
  if (validatedData.price && validatedData.price.currency) {
    if (!hasRate(rates, validatedData.price.currency)) {
      return {
        ok: false,
        status: 400,
        error: `Currency '${validatedData.price.currency}' is not supported. Please use a supported currency code.`,
      };
    }
  }

  // Who may change what, and under which condition each write is made.
  const plan = planItemUpdate(currentItem, validatedData, actor);
  if (!plan.ok) return plan;
  const {
    updateData,
    reservationAction,
    bookingGuard,
    proposalGuard,
    publishesLiveItem,
    endsGroupGift,
    approvedProposer,
  } = plan;

  // A book or unbook was decided on the item as read above, so it's written
  // only if the item is still that way: still available to book, or still the
  // caller's booking to unbook. Otherwise another member's booking, or an
  // owner's status change, landing in between would be overwritten by this
  // write, and the Reservation below would no longer match the item. A
  // proposer's edit, likewise, only while the item is still their proposal,
  // or it would overwrite an owner's approval that landed in between, and an
  // owner's approval only while the item is still a proposal. An owner's
  // other edits are written unconditionally, as on any item, but for a publish
  // or reopen's status change (below).
  // A review request (above) is written only while the item is still a
  // proposal, whatever else it changes: an approval's own guard already says
  // so, and a proposer's says more.
  const reviewGuard: ItemWriteGuard | null = expectsProposal
    ? { filter: { status: 'proposed' }, conflict: PROPOSAL_REVIEWED_ERROR }
    : null;
  const writeGuard = bookingGuard ?? proposalGuard ?? reviewGuard;
  // An edit that replaces or clears the image frees the one it replaced, so its
  // write hands back the item as it was just before it landed.
  const replacesImage = updateData.imageUrl !== undefined;
  const writeOptions = {
    returnDocument: replacesImage ? ('before' as const) : ('after' as const),
    runValidators: true,
  };
  // An owner's publish or reopen is written only on an item that isn't booked
  // (see where it's set in the plan): the filter, not the earlier read,
  // decides, so a member booking it in between keeps their booking.
  // An approve's version (above) is a condition on its write too: an edit
  // landing after the read is caught here.
  // The links, both sides (WIS-29), before the rest of the edit: each side's
  // write is conditional, so a partner filled up or gone since the check
  // above refuses it, and the request is answered with that before anything
  // else of it is written.
  if (linkChanges.linkItems || linkChanges.unlinkItems) {
    const linked = await writeItemLinks(id, wishlist._id.toString(), linkChanges);
    if (!linked.ok) {
      return { ok: false, status: linked.status, error: linked.error };
    }
  }

  // A links-only edit has nothing to set here: the item is read as it is.
  let written =
    Object.keys(updateData).length === 0 && !writeGuard && !expectedVersion
      ? await Item.findById(id)
      : await Item.findOneAndUpdate(
          {
            _id: id,
            ...writeGuard?.filter,
            ...(expectedVersion && { updatedAt: expectedVersion }),
            ...(publishesLiveItem && { status: { $ne: 'booked' } }),
          },
          {
            $set: updateData,
            ...(endsGroupGift && { $unset: { groupGift: 1, groupGiftRev: 1 } }),
          },
          writeOptions
        );
  if (!written && publishesLiveItem) {
    // Booked (or gone). The status change is dropped, and whatever else the
    // owner sent lands as any content edit would, unconditionally. The answer
    // is then the one an unbooked item gets, since the owner's folds `booked`
    // into `available`.
    const contentOnly = { ...updateData };
    delete contentOnly.status;
    delete contentOnly.bookedBy;
    written =
      Object.keys(contentOnly).length > 0
        ? await Item.findOneAndUpdate({ _id: id }, { $set: contentOnly }, writeOptions)
        : await Item.findById(id);
  }

  if (!written) {
    // The item changed, or went, since it was read. Nothing was written, so the
    // Reservation isn't touched either: a booking that lost creates none, and
    // an unbook that lost leaves the gifter's in place. Nor is any image freed,
    // so an approved item keeps the one it has, and no proposer is told of an
    // approval that didn't land.
    if (expectedVersion) {
      // Still a proposal, so it lost to an edit; anything else was a review.
      const now = await Item.findById(id);
      if (now?.status === 'proposed') return editedFailure(now);
    }
    return unmatchedItemFailure(id, writeGuard);
  }

  let item = written;
  if (replacesImage) {
    // Free the image this write replaced: the one the item had as it landed,
    // not the one read above. A co-owner (or the proposer) replacing it in
    // between has freed that one already, and nothing else would free theirs.
    // Only our own uploads are touched; pasted external URLs are left alone.
    await freeReplacedImage(written.imageUrl, updateData.imageUrl);
    // The rest of the request works on the item as it is now. One deleted
    // since this write landed is answered like any other missing item (and a
    // proposer isn't told their proposal was approved into the list).
    const now = await Item.findById(id);
    if (!now) return itemNotFound();
    item = now;
  }

  if (endsGroupGift) await endItemGroupGifts(item._id);

  // An owner's status change or review can move the item in or out of the count
  // on the list's share card (a member's booking never does).
  if (isOwner && updateData.status !== undefined) {
    await purgeShareCards({ wishlistIds: [wishlist._id.toString()] });
  }

  // Keep the gifter's durable Reservation in sync with their booking, now that
  // the item write above has matched. Only the gifter's own book/unbook writes
  // it; owner status changes don't, so the reservation (and the ability to log
  // the gift) survives them. The helpers re-check the item once the Reservation
  // is written or deleted, in case the gifter's own book and unbook from two
  // tabs crossed (see `lib/utils/bookingReservations.ts`).
  if (reservationAction === 'create') {
    const previous = await writeBookingReservation(userId, wishlist, item);
    // The caller was read as a member at the top of the request. If they've
    // since left, been removed, become an owner, or the list was archived, the
    // booking is undone rather than left where nobody can release it.
    const lost = await undoBookingUnlessMember({
      wishlistId: wishlist._id,
      itemId: item._id,
      gifterId: userId,
      previous,
    });
    if (lost) return lostBookingFailure(lost);
    await settleBookingReservation(userId, wishlist, item, previous);
  } else if (reservationAction === 'delete') {
    await cancelUnbookedReservation(userId, wishlist, item._id);
  }

  // Let the proposer know their item was accepted into the list.
  if (approvedProposer) {
    await createNotification({
      user: approvedProposer,
      type: 'proposal_approved',
      actorUsername: null,
      wishlist: wishlist._id,
      wishlistName: wishlist.name,
      wishlistSlug: wishlist.slug ?? null,
      itemName: item.name,
    });
  }

  // Shaped exactly as GET /items shapes it (serializeItem), so a PATCH can
  // never show what the list read hides: owners never see a booking or a
  // proposer, and nobody gets anyone else's id. It also carries the list
  // read's `priceInUsdCents`, so a re-priced item sorts by its new price
  // without waiting for the next poll. Anyone else who got this far is a
  // proposer who isn't a member, editing their own proposal.
  const viewer: ItemViewer = isOwner
    ? { role: 'owner' }
    : isMember
      ? {
          role: 'member',
          id: userId,
          givenByViewer: await readGivenByViewer(userId, [item]),
          groupGifts: await readGroupGiftSummaries(userId, [item]),
        }
      : { role: 'proposer', id: userId };

  return { ok: true, data: serializeItem(item, viewer, rates, await readItemRefs(item, isOwner)) };
}

/**
 * Delete an item: an owner's delete or Decline, or a proposer withdrawing their
 * own pending proposal. Trusts `isOwner`: the caller must have decided it with
 * `isWishlistOwner` on the list as read, and refused anyone who is neither.
 */
export async function deleteItem({
  item,
  wishlist,
  isOwner,
  userId,
  expectsProposal,
}: {
  /** The item as read at the top of the request. */
  item: Pick<IItem, '_id' | 'status'>;
  wishlist: Pick<IWishlist, '_id'>;
  /** False only for the proposer of a still-pending proposal. */
  isOwner: boolean;
  userId: string;
  /** The review dialog's Decline: it expects the item to still be a proposal (WIS-199). */
  expectsProposal: boolean;
}): Promise<DeleteItemResult> {
  const id = item._id.toString();

  // The owner check is already the last read before this delete, so re-reading
  // the list here wouldn't narrow the gap a co-owner's removal could land in.
  // An item can't carry its list's owners, so closing that gap would take a
  // transaction.
  //
  // A proposer's withdrawal, though, rests on the item itself, as read: still
  // a proposal, and theirs. So, like their edit, it's deleted only while it
  // still is. An owner approving it in between makes it a live item, which
  // only owners may delete.
  //
  // An owner's Decline from the review dialog rests on the item being the
  // proposal it reviewed, too: one approved since (by a co-owner, say) is a
  // live item the owner never meant to delete, and may be reserved, which
  // they can't see. So it's refused once the item isn't a proposal, here and
  // as a condition on the delete, with one answer whatever it has become.
  // Any other owner delete goes on as before.
  if (expectsProposal && item.status !== 'proposed') {
    return { ok: false, status: 409, error: PROPOSAL_REVIEWED_ERROR };
  }
  const withdrawalGuard: ItemWriteGuard | null = !isOwner
    ? {
        filter: { status: 'proposed', proposedBy: userId },
        conflict: 'This item is no longer a proposal you can withdraw',
      }
    : expectsProposal
      ? { filter: { status: 'proposed' }, conflict: PROPOSAL_REVIEWED_ERROR }
      : null;
  const deleted = await Item.findOneAndDelete({ _id: id, ...withdrawalGuard?.filter });
  if (!deleted) {
    // A withdrawal that lost to an approval gets the 409, and so does a
    // Decline that lost to one. An item another request deleted first
    // (another owner's delete, a second tab) is a 404, for an owner too.
    // Either way this deleted nothing, so frees nothing.
    return unmatchedItemFailure(id, withdrawalGuard);
  }

  // A group gift on it ends with it (WIS-361), its contributors keeping their
  // Reservations, as a solo gifter keeps theirs.
  await endItemGroupGifts(deleted._id);

  // Take it off the items it went with (WIS-29). Best-effort: a partner
  // still naming it shows no chip for it, as it no longer exists.
  await unlinkDeletedItem(deleted._id, deleted.wishlist);

  // Free the item's uploaded image, if it was one of ours: the one it had when
  // it was deleted, since an edit since the read may have replaced it.
  await deleteOwnBlob(deleted.imageUrl);
  // A visible item going changes the count on the list's share card.
  if (isCountedOnShareCard(deleted.status)) {
    await purgeShareCards({ wishlistIds: [wishlist._id.toString()] });
  }

  return { ok: true };
}
