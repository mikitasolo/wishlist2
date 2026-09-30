import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Item, { IItem } from '@/models/Item';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Reservation from '@/models/Reservation';
import { updateItemSchema, validateRequestBody } from '@/lib/validations';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { canAttachImage, deleteOwnBlob, FOREIGN_IMAGE_ERROR } from '@/lib/utils/blob';
import { createNotification } from '@/lib/notifications';
import { isWishlistOwner, primaryOwnerId } from '@/lib/utils/wishlistOwners';

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

    const currentItem = await Item.findById(id);
    if (!currentItem) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(currentItem.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
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

    // Ensure currency rates are up to date for validation
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates || new Map<string, number>();

    // Validate currency exists in rates if price is being updated
    if (validatedData.price && validatedData.price.currency) {
      const currencyLower = validatedData.price.currency.toLowerCase(); // Already lowercase from validation, but ensure it
      if (!rates.has(currencyLower)) {
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
                currency: validatedData.price.currency.toLowerCase(),
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
                currency: validatedData.price.currency.toLowerCase(),
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
              currency: (validatedData.price.currency || 'usd').toLowerCase(),
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
              error: 'Owners can only set an item to draft, available or completed',
            },
            { status: 400 }
          );
        }
        updateData.status = status;
        // None of these is 'booked', so the item comes out with no booker: moving
        // off 'booked' (including to 'completed') unassigns it. Cleared whatever
        // the earlier read said, since a member may have booked since. The
        // gifter's Reservation is kept, so they can still log the gift.
        updateData.bookedBy = null;
      }
    } else {
      // Regular members can only update status (for booking/unbooking)
      if (validatedData.status !== undefined) {
        // Allow booking available items
        if (validatedData.status === 'booked' && currentItem.status === 'available') {
          updateData.status = 'booked';
          updateData.bookedBy = new mongoose.Types.ObjectId(session.user.id);
          reservationAction = 'create';
        }
        // Allow unbooking only items booked by the current user
        else if (validatedData.status === 'available' && currentItem.status === 'booked') {
          if (currentItem.bookedBy?.toString() !== session.user.id) {
            return NextResponse.json(
              { success: false, error: 'You can only unbook items you have booked' },
              { status: 403 }
            );
          }
          updateData.status = 'available';
          updateData.bookedBy = null;
          reservationAction = 'delete';
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

    const item = await Item.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    // Keep the gifter's durable Reservation in sync with their booking. Only the
    // gifter's own book/unbook touches it; owner status changes never do, so the
    // reservation (and the ability to log the gift) survives them.
    if (reservationAction === 'create') {
      await Reservation.findOneAndUpdate(
        { gifter: session.user.id, item: item._id },
        {
          $set: {
            gifter: session.user.id,
            wishlist: wishlist._id,
            item: item._id,
            // Snapshot of the recipient. A co-owned list has several owners, so
            // this pins the primary one — a `GiftLog` records one recipient, and
            // the snapshot deliberately doesn't follow later ownership changes.
            owner: primaryOwnerId(wishlist),
            itemName: item.name,
            itemImage: item.imageUrl ?? null,
            itemPrice: item.price ?? null,
            wishlistName: wishlist.name,
          },
        },
        { upsert: true }
      );
    } else if (reservationAction === 'delete') {
      await Reservation.deleteMany({ gifter: session.user.id, item: item._id });
    }

    // If this edit replaced or cleared the image, free the old uploaded blob.
    // Only our own uploads are touched; pasted external URLs are left alone.
    if (updateData.imageUrl !== undefined && currentItem.imageUrl !== updateData.imageUrl) {
      await deleteOwnBlob(currentItem.imageUrl);
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

    // Sanitize the reply with the SAME privacy rules as GET /items so a PATCH
    // can never leak what the list endpoint hides:
    //  - proposals are anonymous to the owner (never return `proposedBy` to
    //    anyone but the proposer themselves), and
    //  - owners never see booking status (booked folds into available).
    const itemObj = item.toObject();
    const isProposedByMe = itemObj.proposedBy?.toString() === session.user.id;
    const isBookedByMe = itemObj.bookedBy?.toString() === session.user.id;

    let responseData;
    if (isOwner) {
      // Owner: hide the proposer and any booking.
      responseData = {
        ...itemObj,
        status: itemObj.status === 'booked' ? 'available' : itemObj.status,
        bookedBy: undefined,
        proposedBy: undefined,
      };
    } else if (isMember) {
      // Members may see booking status, but only their own booking/proposal id.
      responseData = {
        ...itemObj,
        bookedBy: isBookedByMe ? session.user.id : undefined,
        proposedBy: isProposedByMe ? session.user.id : undefined,
      };
    } else {
      // Any other authorized viewer (e.g. a proposer who isn't a member).
      responseData = {
        ...itemObj,
        status: itemObj.status === 'booked' ? 'available' : itemObj.status,
        bookedBy: undefined,
        proposedBy: isProposedByMe ? session.user.id : undefined,
      };
    }

    return NextResponse.json({ success: true, data: responseData }, { status: 200 });
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

    const item = await Item.findById(id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(item.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
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

    await Item.findByIdAndDelete(id);

    // Free the item's uploaded image, if it was one of ours.
    await deleteOwnBlob(item.imageUrl);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 });
  }
}
