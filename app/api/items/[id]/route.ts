import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import mongoose, { type FilterQuery } from 'mongoose';
import Item, { IItem } from '@/models/Item';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { updateItemSchema, validateRequestBody } from '@/lib/validations';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { hasRate, normalizeCurrency } from '@/lib/utils/currency';
import { readGivenByViewer, serializeItem, type ItemViewer } from '@/lib/utils/itemSerializer';
import {
  canAttachImage,
  deleteOwnBlob,
  FOREIGN_IMAGE_ERROR,
  freeReplacedImage,
  isSameImage,
} from '@/lib/utils/blob';
import {
  cancelUnbookedReservation,
  settleBookingReservation,
  writeBookingReservation,
} from '@/lib/utils/bookingReservations';
import { createNotification } from '@/lib/notifications';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { undoBookingUnlessMember, type LostBookingReason } from '@/lib/utils/lateBooking';
import { isCountedOnShareCard } from '@/lib/og/data';
import { purgeShareCards } from '@/lib/og/purge';
import {
  EXPECTED_PROPOSAL,
  EXPECTED_STATUS_PARAM,
  PROPOSAL_REVIEWED_ERROR,
  PROPOSAL_EDITED_ERROR,
} from '@/lib/utils/proposalReview';

/** An owner's status change that isn't publish, draft or received (an owner can't reserve). */
const OWNER_STATUS_ERROR =
  'Owners can only publish an item, move it to draft or mark it as received';

/**
 * The answer to a booking undone because the caller stopped being a plain member
 * while it was in flight (see `undoBookingUnlessMember`): the one they'd have got
 * had that change landed before the request.
 */
function lostBookingResponse(reason: LostBookingReason) {
  if (reason === 'not-member') {
    return NextResponse.json(
      { success: false, error: 'Unauthorized - No access to this wishlist' },
      { status: 403 }
    );
  }
  if (reason === 'owner') {
    return NextResponse.json({ success: false, error: OWNER_STATUS_ERROR }, { status: 400 });
  }
  // The list was archived, which hides it from everyone but its owners.
  return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
}

/**
 * A write or delete decided on the item as read at the top of the request, so
 * made only while the item is still that way: what it requires of the item
 * (merged into the write's filter), and the answer when the item no longer is.
 */
type ItemWriteGuard = { filter: FilterQuery<IItem>; conflict: string };

/**
 * The answer to an item write or delete that matched nothing. With a guard, an
 * item that's still there changed since it was read: 409, with the guard's
 * conflict. Otherwise the item has gone: 404.
 */
async function unmatchedItemResponse(id: string, guard: ItemWriteGuard | null) {
  if (guard && (await Item.exists({ _id: id }))) {
    return NextResponse.json({ success: false, error: guard.conflict }, { status: 409 });
  }
  return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
}

// PATCH /api/items/[id] - Update an item
// Members can book/unbook items (only their own bookings)
// Wishlist owners can edit content and publish/draft/complete/reopen, never book
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    // Covers edits and book/unbook toggles — curb toggle churn + notification noise.
    const limited = await enforce('booking', userKey(session.user.id));
    if (limited) return limited;

    await connectDB();

    const currentUser = await User.findById(session.user.id);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 });
    }

    const { id } = await params;

    const currentItem = isObjectIdParam(id) ? await Item.findById(id) : null;
    if (!currentItem) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(currentItem.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // An archived list is owner-only, so nobody else may book, unbook or edit a
    // proposal on it. Answered like a missing item, so it doesn't reveal the list.
    if (isHiddenByArchive(wishlist, session.user.id)) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    // Check if user has access to this wishlist. Every co-owner is an owner, so
    // none of them can book, and none of them see booking state in the response.
    const isOwner = isWishlistOwner(wishlist, session.user.id);
    const isMember = !!(await WishlistMember.findOne({
      wishlist: wishlist._id,
      user: session.user.id,
    }));
    const isProposer = currentItem.proposedBy?.toString() === session.user.id;
    const hasAccess = isOwner || isMember || isProposer;

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No access to this wishlist' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, updateItemSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const validatedData = validation.data;

    // The review dialog's approve expects a proposal (WIS-199): one that's been
    // approved since the dialog opened, by a co-owner or in another tab, isn't
    // the item it reviewed, and writing the dialog's form over it would replace
    // that review (and unassign a booking made since). Refused whatever the item
    // is now, with one answer that never says it's reserved.
    const expectsProposal = validatedData.expectedStatus === EXPECTED_PROPOSAL;
    if (expectsProposal && currentItem.status !== 'proposed') {
      return NextResponse.json({ success: false, error: PROPOSAL_REVIEWED_ERROR }, { status: 409 });
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
    const editedResponse = (edited: IItem) =>
      NextResponse.json(
        {
          success: false,
          error: PROPOSAL_EDITED_ERROR,
          data: serializeItem(edited, { role: 'owner' }, rates),
        },
        { status: 409 }
      );
    if (expectedVersion && currentItem.updatedAt.getTime() !== expectedVersion.getTime()) {
      return editedResponse(currentItem);
    }

    // Validate currency exists in rates if price is being updated
    if (validatedData.price && validatedData.price.currency) {
      if (!hasRate(rates, validatedData.price.currency)) {
        return NextResponse.json(
          {
            success: false,
            error: `Currency '${validatedData.price.currency}' is not supported. Please use a supported currency code.`,
          },
          { status: 400 }
        );
      }
    }

    // Booking side effect to run after the item update: a member booking an item
    // creates their durable Reservation; unbooking removes it. Gifting is handled
    // separately (on the Reservation, not the item) so it survives item changes.
    let reservationAction: 'create' | 'delete' | null = null;

    // A member's book or unbook: what it requires of the item when its write
    // lands (see the write below), and the answer when the item no longer is
    // that way. Null for every other change.
    let bookingGuard: ItemWriteGuard | null = null;
    // The same for a proposer's edit of their own proposal, or an owner's
    // approval of one; null otherwise.
    let proposalGuard: ItemWriteGuard | null = null;
    // An owner's publish or reopen (`available` on a live item): set only on an
    // item that isn't booked, see the write below.
    let publishesLiveItem = false;

    let updateData: Partial<
      Pick<
        IItem,
        | 'name'
        | 'imageUrl'
        | 'price'
        | 'link'
        | 'notes'
        | 'mostWanted'
        | 'status'
        | 'bookedBy'
        | 'proposedBy'
      >
    > = {};

    // If an owner approves a proposed item below, remember the proposer
    // so we can notify them after the update succeeds.
    let approvedProposer: mongoose.Types.ObjectId | null = null;

    // Handle proposed items
    if (currentItem.status === 'proposed') {
      // Owners review proposed items (change status and clear proposedBy)
      if (isOwner) {
        if (validatedData.name !== undefined) updateData.name = validatedData.name;
        if (validatedData.imageUrl !== undefined) updateData.imageUrl = validatedData.imageUrl;
        if (validatedData.price !== undefined) {
          updateData.price = validatedData.price
            ? {
                value: validatedData.price.value, // Already in cents (integer)
                currency: normalizeCurrency(validatedData.price.currency),
              }
            : null;
        }
        if (validatedData.link !== undefined) updateData.link = validatedData.link ?? null;
        if (validatedData.notes !== undefined) updateData.notes = validatedData.notes ?? null;
        if (validatedData.mostWanted !== undefined)
          updateData.mostWanted = validatedData.mostWanted;
        if (validatedData.status !== undefined) {
          // Owner can change from proposed to draft or available
          if (validatedData.status === 'draft' || validatedData.status === 'available') {
            updateData.status = validatedData.status;
            updateData.proposedBy = null; // Clear proposedBy when approving
            // A proposal can't be booked, so any bookedBy on one is a stray (older
            // creates accepted it); don't carry it onto the live item.
            updateData.bookedBy = null;
            if (currentItem.proposedBy) approvedProposer = currentItem.proposedBy;
            // An approval rests on the item as read still being a proposal, so
            // it's written only while it is. A co-owner approving it in between
            // already made it live: this one would overwrite their review (and
            // unassign a booking made since) and notify the proposer twice.
            proposalGuard = {
              filter: { status: 'proposed' },
              conflict: PROPOSAL_REVIEWED_ERROR,
            };
          } else {
            return NextResponse.json(
              { success: false, error: 'Can only change proposed items to draft or available' },
              { status: 400 }
            );
          }
        }
      }
      // Proposer can edit their proposed items (but not change status)
      else if (isProposer) {
        if (validatedData.name !== undefined) updateData.name = validatedData.name;
        if (validatedData.imageUrl !== undefined) updateData.imageUrl = validatedData.imageUrl;
        if (validatedData.price !== undefined) {
          updateData.price = validatedData.price
            ? {
                value: validatedData.price.value, // Already in cents (integer)
                currency: normalizeCurrency(validatedData.price.currency),
              }
            : null;
        }
        if (validatedData.link !== undefined) updateData.link = validatedData.link ?? null;
        if (validatedData.notes !== undefined) updateData.notes = validatedData.notes ?? null;
        // mostWanted is the owners' call, so a proposer's value is ignored.
        // Proposers cannot change status of proposed items
        if (validatedData.status !== undefined && validatedData.status !== 'proposed') {
          return NextResponse.json(
            { success: false, error: 'You cannot change the status of a proposed item' },
            { status: 403 }
          );
        }
        // Allowed only because the item as read is their proposal, so it's
        // written only while it still is. An owner approving it in between makes
        // it a live item, which only owners may edit.
        proposalGuard = {
          filter: { status: 'proposed', proposedBy: session.user.id },
          conflict: 'This item is no longer a proposal you can edit',
        };
      } else {
        return NextResponse.json(
          { success: false, error: 'Only owner and proposer can edit proposed items' },
          { status: 403 }
        );
      }
    }
    // An owner may edit the content and make the explicit status changes
    else if (isOwner) {
      if (validatedData.name !== undefined) updateData.name = validatedData.name;
      if (validatedData.imageUrl !== undefined) updateData.imageUrl = validatedData.imageUrl;
      if (validatedData.price !== undefined) {
        updateData.price = validatedData.price
          ? {
              value: validatedData.price.value,
              currency: normalizeCurrency(validatedData.price.currency),
            }
          : null;
      }
      if (validatedData.link !== undefined) updateData.link = validatedData.link ?? null;
      if (validatedData.notes !== undefined) updateData.notes = validatedData.notes ?? null;
      // A content edit like the others: it never touches status or bookedBy.
      if (validatedData.mostWanted !== undefined) updateData.mostWanted = validatedData.mostWanted;
      if (validatedData.status !== undefined) {
        // Owners publish, move to draft, complete or reopen, and nothing else. A
        // booking only comes from a member booking the item (below), which also
        // writes the Reservation that lets them release it, and only a member's
        // proposal is `proposed`. Refused whatever the item's current status, so
        // the answer never tells a booking-blind owner the item is booked.
        const status = validatedData.status;
        if (status !== 'draft' && status !== 'available' && status !== 'completed') {
          return NextResponse.json(
            {
              success: false,
              error: OWNER_STATUS_ERROR,
            },
            { status: 400 }
          );
        }
        updateData.status = status;
        // None of these is 'booked', so the item comes out with no booker: moving
        // a booked item to draft or marking it received unassigns it. Cleared
        // whatever the earlier read said, since a member may have booked since.
        // The gifter's Reservation is kept, so they can still log the gift.
        updateData.bookedBy = null;
        // Publish and reopen are never meant for a live item, and an owner sees a
        // booked one as available, so `available` on it can only come from a
        // stale view (a co-owner published it and a member booked it since).
        // Releasing that booking would leave it bookable again while its gifter
        // still holds a Reservation: two gifters, one item. So it's a no-op on a
        // booked item (status and bookedBy stay), decided by the write itself,
        // and never refused: the owner's answer folds `booked` into `available`,
        // so it's the same as on an unbooked item (WIS-108).
        publishesLiveItem = status === 'available';
      }
    } else {
      // Regular members can only update status (for booking/unbooking)
      if (validatedData.status !== undefined) {
        // Allow booking available items
        if (validatedData.status === 'booked' && currentItem.status === 'available') {
          updateData.status = 'booked';
          updateData.bookedBy = new mongoose.Types.ObjectId(session.user.id);
          reservationAction = 'create';
          bookingGuard = {
            filter: { status: 'available' },
            conflict: 'This item is no longer available to reserve',
          };
        }
        // Allow unbooking only items booked by the current user
        else if (validatedData.status === 'available' && currentItem.status === 'booked') {
          if (currentItem.bookedBy?.toString() !== session.user.id) {
            return NextResponse.json(
              { success: false, error: 'You can only release items you have reserved' },
              { status: 403 }
            );
          }
          updateData.status = 'available';
          updateData.bookedBy = null;
          reservationAction = 'delete';
          bookingGuard = {
            filter: { status: 'booked', bookedBy: session.user.id },
            conflict: 'This item is no longer reserved by you',
          };
        }
        // Don't allow other status changes
        else {
          return NextResponse.json(
            { success: false, error: 'Invalid status transition' },
            { status: 400 }
          );
        }
      }

      // If no valid fields to update
      if (Object.keys(updateData).length === 0) {
        return NextResponse.json(
          { success: false, error: 'Insufficient permissions to update these fields' },
          { status: 403 }
        );
      }
    }

    // Checked on what's about to be written, whichever branch above set it. An
    // unchanged URL passes, so co-owners and owners approving a proposal keep
    // an image someone else uploaded.
    if (
      updateData.imageUrl !== undefined &&
      !canAttachImage(updateData.imageUrl, session.user.id, currentItem.imageUrl)
    ) {
      return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
    }

    // The review form sends the image back with every save, changed or not (the
    // edit form only sends one the owner changed). An unchanged one isn't
    // written: written back, it would undo a replacement (a co-owner's, or the
    // proposer's) landing after the read above, and restore the image that
    // replacement had already freed.
    if (
      updateData.imageUrl !== undefined &&
      isSameImage(updateData.imageUrl, currentItem.imageUrl)
    ) {
      delete updateData.imageUrl;
    }

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
    // (see where it's set above): the filter, not the earlier read, decides, so a
    // member booking it in between keeps their booking.
    // An approve's version (above) is a condition on its write too: an edit
    // landing after the read is caught here.
    let written = await Item.findOneAndUpdate(
      {
        _id: id,
        ...writeGuard?.filter,
        ...(expectedVersion && { updatedAt: expectedVersion }),
        ...(publishesLiveItem && { status: { $ne: 'booked' } }),
      },
      { $set: updateData },
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
        if (now?.status === 'proposed') return editedResponse(now);
      }
      return unmatchedItemResponse(id, writeGuard);
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
      if (!now) {
        return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
      }
      item = now;
    }

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
      const previous = await writeBookingReservation(session.user.id, wishlist, item);
      // The caller was read as a member at the top of the request. If they've
      // since left, been removed, become an owner, or the list was archived, the
      // booking is undone rather than left where nobody can release it.
      const lost = await undoBookingUnlessMember({
        wishlistId: wishlist._id,
        itemId: item._id,
        gifterId: session.user.id,
        previous,
      });
      if (lost) return lostBookingResponse(lost);
      await settleBookingReservation(session.user.id, wishlist, item, previous);
    } else if (reservationAction === 'delete') {
      await cancelUnbookedReservation(session.user.id, wishlist, item._id);
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
            id: session.user.id,
            givenByViewer: await readGivenByViewer(session.user.id, [item]),
          }
        : { role: 'proposer', id: session.user.id };

    return NextResponse.json(
      { success: true, data: serializeItem(item, viewer, rates) },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json({ success: false, error: 'Failed to update item' }, { status: 500 });
  }
}

// DELETE /api/items/[id] - Delete an item
// Owners can delete any item
// Proposers can delete their own proposed items
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();
    const { id } = await params;

    const item = isObjectIdParam(id) ? await Item.findById(id) : null;
    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(item.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Owner-only once archived: a proposer can't withdraw on it either (see PATCH).
    if (isHiddenByArchive(wishlist, session.user.id)) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const isOwner = isWishlistOwner(wishlist, session.user.id);
    const isProposer =
      item.status === 'proposed' && item.proposedBy?.toString() === session.user.id;
    // Only an owner, or the proposer of a still-pending proposal, may delete.
    if (!isOwner && !isProposer) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner or proposer access required' },
        { status: 403 }
      );
    }

    // The review dialog's Decline says it expects a proposal (WIS-199).
    const expected = request.nextUrl.searchParams.get(EXPECTED_STATUS_PARAM);
    if (expected !== null && expected !== EXPECTED_PROPOSAL) {
      return NextResponse.json(
        { success: false, error: `${EXPECTED_STATUS_PARAM} must be ${EXPECTED_PROPOSAL}` },
        { status: 400 }
      );
    }
    const expectsProposal = expected === EXPECTED_PROPOSAL;

    // The owner check above is already the last read before this delete, so
    // re-reading the list here wouldn't narrow the gap a co-owner's removal could
    // land in. An item can't carry its list's owners, so closing that gap would
    // take a transaction.
    //
    // A proposer's withdrawal, though, rests on the item itself, as read above:
    // still a proposal, and theirs. So, like their edit in PATCH, it's deleted
    // only while it still is. An owner approving it in between makes it a live
    // item, which only owners may delete.
    //
    // An owner's Decline from the review dialog rests on the item being the
    // proposal it reviewed, too: one approved since (by a co-owner, say) is a
    // live item the owner never meant to delete, and may be reserved, which
    // they can't see. So it's refused once the item isn't a proposal, here and
    // as a condition on the delete, with one answer whatever it has become.
    // Any other owner delete goes on as before.
    if (expectsProposal && item.status !== 'proposed') {
      return NextResponse.json({ success: false, error: PROPOSAL_REVIEWED_ERROR }, { status: 409 });
    }
    const withdrawalGuard: ItemWriteGuard | null = !isOwner
      ? {
          filter: { status: 'proposed', proposedBy: session.user.id },
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
      return unmatchedItemResponse(id, withdrawalGuard);
    }

    // Free the item's uploaded image, if it was one of ours: the one it had when
    // it was deleted, since an edit since the read may have replaced it.
    await deleteOwnBlob(deleted.imageUrl);
    // A visible item going changes the count on the list's share card.
    if (isCountedOnShareCard(deleted.status)) {
      await purgeShareCards({ wishlistIds: [wishlist._id.toString()] });
    }

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 });
  }
}
