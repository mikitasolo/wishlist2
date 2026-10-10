import mongoose, { type FilterQuery } from 'mongoose';
import type { z } from 'zod';
import type { IItem } from '@/models/Item';
import type { updateItemSchema } from '@/lib/validations';
import { normalizeCurrency } from '@/lib/utils/currency';
import { canAttachImage, FOREIGN_IMAGE_ERROR, isSameImage } from '@/lib/utils/blob';
import { GROUP_GIFT_UNBOOK_ERROR } from '@/lib/utils/groupGifts';
import { PROPOSAL_REVIEWED_ERROR } from '@/lib/utils/proposalReview';
import type { SerializedItem } from '@/lib/utils/itemSerializer';

/**
 * Deciding what an item edit writes (WIS-373): which fields, under which
 * conditions, and with which side effects, from the item as read and the
 * caller's role on its list. No reads or writes: `updateItem`
 * (`lib/utils/itemActions.ts`) makes them, in order, from the plan.
 */

/** A validated `PATCH /api/items/[id]` body. */
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

/** An owner's status change that isn't publish, draft or received (an owner can't reserve). */
export const OWNER_STATUS_ERROR =
  'Owners can only publish an item, move it to draft or mark it as received';

/**
 * A write or delete decided on the item as read at the top of the request, so
 * made only while the item is still that way: what it requires of the item
 * (merged into the write's filter), and the answer when the item no longer is.
 */
export type ItemWriteGuard = { filter: FilterQuery<IItem>; conflict: string };

/** The fields an item edit may `$set`. */
export type ItemUpdateData = Partial<
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
>;

/** The caller, as the route resolved them on the item's list. */
export type ItemActor = {
  userId: string;
  isOwner: boolean;
  isProposer: boolean;
};

export type ItemUpdatePlan = {
  updateData: ItemUpdateData;
  /**
   * Booking side effect to run after the item update: a member booking an item
   * creates their durable Reservation; unbooking removes it. Gifting is handled
   * separately (on the Reservation, not the item) so it survives item changes.
   */
  reservationAction: 'create' | 'delete' | null;
  /**
   * A member's book or unbook: what it requires of the item when its write
   * lands, and the answer when the item no longer is that way. Null for every
   * other change.
   */
  bookingGuard: ItemWriteGuard | null;
  /** The same for a proposer's edit of their own proposal, or an owner's approval of one. */
  proposalGuard: ItemWriteGuard | null;
  /**
   * An owner's publish or reopen (`available` on a live item): set only on an
   * item that isn't booked, see `updateItem`.
   */
  publishesLiveItem: boolean;
  /** An owner's draft or received, which ends any group gift on the item. */
  endsGroupGift: boolean;
  /** The proposer to tell once an owner's approval has landed. */
  approvedProposer: mongoose.Types.ObjectId | null;
};

/**
 * A refused or lost item action: the HTTP status and error, plus (only for an
 * approve that lost to an edit) the proposal as it is now, to refill the form.
 */
export type ItemActionFailure = {
  ok: false;
  status: number;
  error: string;
  data?: SerializedItem;
};

/**
 * The content fields of an edit (name, image, price, link, notes, and the
 * owners' `mostWanted`). Never `status` or `bookedBy`: a content edit never
 * changes an item's status.
 */
function contentChanges(data: UpdateItemInput, withMostWanted: boolean): ItemUpdateData {
  const updateData: ItemUpdateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
  if (data.price !== undefined) {
    updateData.price = data.price
      ? {
          value: data.price.value, // Already in cents (integer)
          currency: normalizeCurrency(data.price.currency),
        }
      : null;
  }
  if (data.link !== undefined) updateData.link = data.link ?? null;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;
  if (withMostWanted && data.mostWanted !== undefined) updateData.mostWanted = data.mostWanted;
  return updateData;
}

/**
 * Plan an item edit: the role rules for who may change what (owners edit
 * content and publish / draft / complete / reopen, never book; members only
 * book and release their own booking; a proposer edits their own proposal),
 * and the guard each write is made under. A refusal writes nothing.
 */
export function planItemUpdate(
  currentItem: Pick<IItem, 'status' | 'bookedBy' | 'proposedBy' | 'groupGift' | 'imageUrl'>,
  data: UpdateItemInput,
  actor: ItemActor
): ({ ok: true } & ItemUpdatePlan) | ItemActionFailure {
  const { userId, isOwner, isProposer } = actor;
  const plan: ItemUpdatePlan = {
    updateData: {},
    reservationAction: null,
    bookingGuard: null,
    proposalGuard: null,
    publishesLiveItem: false,
    endsGroupGift: false,
    approvedProposer: null,
  };
  const { updateData } = plan;

  // Handle proposed items
  if (currentItem.status === 'proposed') {
    // Owners review proposed items (change status and clear proposedBy)
    if (isOwner) {
      Object.assign(updateData, contentChanges(data, true));
      if (data.status !== undefined) {
        // Owner can change from proposed to draft or available
        if (data.status === 'draft' || data.status === 'available') {
          updateData.status = data.status;
          updateData.proposedBy = null; // Clear proposedBy when approving
          // A proposal can't be booked, so any bookedBy on one is a stray (older
          // creates accepted it); don't carry it onto the live item.
          updateData.bookedBy = null;
          if (currentItem.proposedBy) plan.approvedProposer = currentItem.proposedBy;
          // An approval rests on the item as read still being a proposal, so
          // it's written only while it is. A co-owner approving it in between
          // already made it live: this one would overwrite their review (and
          // unassign a booking made since) and notify the proposer twice.
          plan.proposalGuard = {
            filter: { status: 'proposed' },
            conflict: PROPOSAL_REVIEWED_ERROR,
          };
        } else {
          return {
            ok: false,
            status: 400,
            error: 'Can only change proposed items to draft or available',
          };
        }
      }
    }
    // Proposer can edit their proposed items (but not change status)
    else if (isProposer) {
      // mostWanted is the owners' call, so a proposer's value is ignored.
      Object.assign(updateData, contentChanges(data, false));
      // Proposers cannot change status of proposed items
      if (data.status !== undefined && data.status !== 'proposed') {
        return {
          ok: false,
          status: 403,
          error: 'You cannot change the status of a proposed item',
        };
      }
      // Allowed only because the item as read is their proposal, so it's
      // written only while it still is. An owner approving it in between makes
      // it a live item, which only owners may edit.
      plan.proposalGuard = {
        filter: { status: 'proposed', proposedBy: userId },
        conflict: 'This item is no longer a proposal you can edit',
      };
    } else {
      return {
        ok: false,
        status: 403,
        error: 'Only owner and proposer can edit proposed items',
      };
    }
  }
  // An owner may edit the content and make the explicit status changes
  else if (isOwner) {
    // A content edit, mostWanted included: it never touches status or bookedBy.
    Object.assign(updateData, contentChanges(data, true));
    if (data.status !== undefined) {
      // Owners publish, move to draft, complete or reopen, and nothing else. A
      // booking only comes from a member booking the item (below), which also
      // writes the Reservation that lets them release it, and only a member's
      // proposal is `proposed`. Refused whatever the item's current status, so
      // the answer never tells a booking-blind owner the item is booked.
      const status = data.status;
      if (status !== 'draft' && status !== 'available' && status !== 'completed') {
        return { ok: false, status: 400, error: OWNER_STATUS_ERROR };
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
      plan.publishesLiveItem = status === 'available';
      // Draft or received ends a group gift on it (WIS-361) as it unassigns a
      // solo booking: the write takes the item off the gift, and the gift is
      // ended after it, its contributors keeping their Reservations.
      plan.endsGroupGift = status !== 'available';
    }
  } else {
    // Regular members can only update status (for booking/unbooking)
    if (data.status !== undefined) {
      // Allow booking available items
      if (data.status === 'booked' && currentItem.status === 'available') {
        updateData.status = 'booked';
        updateData.bookedBy = new mongoose.Types.ObjectId(userId);
        plan.reservationAction = 'create';
        plan.bookingGuard = {
          filter: { status: 'available' },
          conflict: 'This item is no longer available to reserve',
        };
      }
      // Allow unbooking only items booked by the current user
      else if (data.status === 'available' && currentItem.status === 'booked') {
        if (currentItem.bookedBy?.toString() !== userId) {
          return {
            ok: false,
            status: 403,
            error: 'You can only release items you have reserved',
          };
        }
        if (currentItem.groupGift) {
          return { ok: false, status: 409, error: GROUP_GIFT_UNBOOK_ERROR };
        }
        updateData.status = 'available';
        updateData.bookedBy = null;
        plan.reservationAction = 'delete';
        // Never a group gift's item (one started since the read above): the
        // gift is released only through its own actions.
        plan.bookingGuard = {
          filter: { status: 'booked', bookedBy: userId, groupGift: null },
          conflict: 'This item is no longer reserved by you',
        };
      }
      // Don't allow other status changes
      else {
        return { ok: false, status: 400, error: 'Invalid status transition' };
      }
    }

    // If no valid fields to update
    if (Object.keys(updateData).length === 0) {
      return {
        ok: false,
        status: 403,
        error: 'Insufficient permissions to update these fields',
      };
    }
  }

  // Checked on what's about to be written, whichever branch above set it. An
  // unchanged URL passes, so co-owners and owners approving a proposal keep
  // an image someone else uploaded.
  if (
    updateData.imageUrl !== undefined &&
    !canAttachImage(updateData.imageUrl, userId, currentItem.imageUrl)
  ) {
    return { ok: false, status: 400, error: FOREIGN_IMAGE_ERROR };
  }

  // The review form sends the image back with every save, changed or not (the
  // edit form only sends one the owner changed). An unchanged one isn't
  // written: written back, it would undo a replacement (a co-owner's, or the
  // proposer's) landing after the read above, and restore the image that
  // replacement had already freed.
  if (updateData.imageUrl !== undefined && isSameImage(updateData.imageUrl, currentItem.imageUrl)) {
    delete updateData.imageUrl;
  }

  return { ok: true, ...plan };
}
