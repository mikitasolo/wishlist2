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

// PATCH /api/items/[id] - Update an item
// Regular members can book/unbook items (only their own bookings)
// Wishlist owner can update all fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 403 }
      );
    }
    
    const { id } = await params;

    const currentItem = await Item.findById(id);
    if (!currentItem) {
      return NextResponse.json(
        { success: false, error: 'Item not found' },
        { status: 404 }
      );
    }

    const wishlist = await Wishlist.findById(currentItem.wishlist);
    if (!wishlist) {
      return NextResponse.json(
        { success: false, error: 'Wishlist not found' },
        { status: 404 }
      );
    }

    // Check if user has access to this wishlist
    const isOwner = wishlist.owner.toString() === session.user.id;
    const membership = await WishlistMember.findOne({
      wishlist: wishlist._id,
      user: session.user.id,
    });
    const hasAccess = isOwner || !!membership;

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
    let updateData: Partial<Pick<IItem, 'name' | 'imageUrl' | 'priceInCents' | 'link' | 'notes' | 'status' | 'bookedBy'>> = {};

    // If user is wishlist owner, allow updating all fields
    if (isOwner) {
      if (validatedData.name !== undefined) updateData.name = validatedData.name;
      if (validatedData.imageUrl !== undefined) updateData.imageUrl = validatedData.imageUrl;
      if (validatedData.priceInCents !== undefined) updateData.priceInCents = validatedData.priceInCents ?? null;
      if (validatedData.link !== undefined) updateData.link = validatedData.link ?? null;
      if (validatedData.notes !== undefined) updateData.notes = validatedData.notes ?? null;
      if (validatedData.status !== undefined) {
        updateData.status = validatedData.status;
        // If status is changing from 'booked' to something else, clear bookedBy
        if (currentItem.status === 'booked' && validatedData.status !== 'booked') {
          updateData.bookedBy = null;
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
      return NextResponse.json(
        { success: false, error: 'Item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: item }, { status: 200 });
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update item' },
      { status: 500 }
    );
  }
}

// DELETE /api/items/[id] - Delete an item (wishlist owner only)
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
      return NextResponse.json(
        { success: false, error: 'Item not found' },
        { status: 404 }
      );
    }

    const wishlist = await Wishlist.findById(item.wishlist);
    if (!wishlist) {
      return NextResponse.json(
        { success: false, error: 'Wishlist not found' },
        { status: 404 }
      );
    }

    // Check if user is owner of this wishlist
    if (wishlist.owner.toString() !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    await Item.findByIdAndDelete(id);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete item' },
      { status: 500 }
    );
  }
}

