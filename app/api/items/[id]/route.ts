import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Item, { IItem } from '@/models/Item';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { updateItemSchema, validateRequestBody } from '@/lib/validations';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';

// PATCH /api/items/[id] - Update an item
// Regular members can book/unbook items (only their own bookings)
// Wishlist owner can update all fields
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is authenticated
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

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

    // Check if user has access to this wishlist
    const isOwner = wishlist.owner.toString() === session.user.id;
    const membership = await WishlistMember.findOne({
      wishlist: wishlist._id,
      user: session.user.id,
    });
    const isAdmin = membership?.role === 'admin';
    const isMember = !!membership;
    const isProposer = currentItem.proposedBy?.toString() === session.user.id;
    const hasAccess = isOwner || isAdmin || isMember || isProposer;

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

    // Booker-only: mark the reserved item as gifted, or undo it.
    //  - gift:   the booker has given the gift → complete the item and unassign
    //            it (same end state as the owner completing it), recording
    //            giftedBy/giftedAt so it stays in the booker's "Gifted" archive.
    //  - undo:   restore it to "booked by me".
    if (validatedData.gifted !== undefined) {
      if (validatedData.gifted) {
        if (
          currentItem.status !== 'booked' ||
          currentItem.bookedBy?.toString() !== session.user.id
        ) {
          return NextResponse.json(
            { success: false, error: 'Only the person who reserved this item can mark it gifted' },
            { status: 403 }
          );
        }
        const updated = await Item.findByIdAndUpdate(
          id,
          {
            $set: {
              status: 'completed',
              bookedBy: null,
              giftedBy: new mongoose.Types.ObjectId(session.user.id),
              giftedAt: new Date(),
            },
          },
          { new: true, runValidators: true }
        );
        return NextResponse.json({ success: true, data: updated }, { status: 200 });
      } else {
        // Undo: only the person who gifted it can move it back to "booked by me".
        // (bookedBy is also accepted to normalize legacy items marked gifted
        // under the old private-marker model, which have no giftedBy.)
        const isGifter = currentItem.giftedBy?.toString() === session.user.id;
        const isLegacyBooker = currentItem.bookedBy?.toString() === session.user.id;
        if (!isGifter && !isLegacyBooker) {
          return NextResponse.json(
            { success: false, error: 'Only the person who gifted this item can undo it' },
            { status: 403 }
          );
        }
        const updated = await Item.findByIdAndUpdate(
          id,
          {
            $set: {
              status: 'booked',
              bookedBy: new mongoose.Types.ObjectId(session.user.id),
              giftedBy: null,
              giftedAt: null,
            },
          },
          { new: true, runValidators: true }
        );
        return NextResponse.json({ success: true, data: updated }, { status: 200 });
      }
    }

    let updateData: Partial<
      Pick<
        IItem,
        | 'name'
        | 'imageUrl'
        | 'price'
        | 'link'
        | 'notes'
        | 'status'
        | 'bookedBy'
        | 'proposedBy'
        | 'giftedBy'
        | 'giftedAt'
      >
    > = {};

    // Handle proposed items
    if (currentItem.status === 'proposed') {
      // Owner and admin can review proposed items (change status and clear proposedBy)
      if (isOwner || isAdmin) {
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
        if (validatedData.status !== undefined) {
          // Owner can change from proposed to draft or available
          if (validatedData.status === 'draft' || validatedData.status === 'available') {
            updateData.status = validatedData.status;
            updateData.proposedBy = null; // Clear proposedBy when approving
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
    // If user is wishlist owner or admin, allow updating all fields
    else if (isOwner || isAdmin) {
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
      if (validatedData.status !== undefined) {
        updateData.status = validatedData.status;
        // If status is changing from 'booked' to something else, clear bookedBy
        if (currentItem.status === 'booked' && validatedData.status !== 'booked') {
          updateData.bookedBy = null;
        }
        // Uncompleting a gifted item clears the gift record so it no longer
        // lingers in someone's "Gifted" archive.
        if (validatedData.status !== 'completed') {
          updateData.giftedBy = null;
          updateData.giftedAt = null;
        }
      }
      if (validatedData.bookedBy !== undefined) {
        updateData.bookedBy = validatedData.bookedBy
          ? new mongoose.Types.ObjectId(validatedData.bookedBy)
          : null;
      }
    } else {
      // Regular members can only update status (for booking/unbooking)
      if (validatedData.status !== undefined) {
        // Allow booking available items
        if (validatedData.status === 'booked' && currentItem.status === 'available') {
          updateData.status = 'booked';
          updateData.bookedBy = new mongoose.Types.ObjectId(session.user.id);
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

    const item = await Item.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: item }, { status: 200 });
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
    const session = await getServerSession(authOptions);

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

    const isOwner = wishlist.owner.toString() === session.user.id;
    const membership = await WishlistMember.findOne({
      wishlist: wishlist._id,
      user: session.user.id,
    });
    const isAdmin = membership?.role === 'admin';
    const isProposer =
      item.status === 'proposed' && item.proposedBy?.toString() === session.user.id;

    // Check if user is owner, admin, or proposer
    if (!isOwner && !isAdmin && !isProposer) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner, admin, or proposer access required' },
        { status: 403 }
      );
    }

    await Item.findByIdAndDelete(id);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 });
  }
}
