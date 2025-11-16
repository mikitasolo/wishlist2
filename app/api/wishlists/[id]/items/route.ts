import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Item from '@/models/Item';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { createItemSchema, validateRequestBody } from '@/lib/validations';

// Helper function to check wishlist access
async function checkWishlistAccess(
  wishlistId: string,
  userId?: string
): Promise<{ hasAccess: boolean; wishlist?: IWishlist }> {
  await connectDB();

  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) {
    return { hasAccess: false };
  }

  // Public wishlists can be viewed by anyone
  if (wishlist.isPublic) {
    return { hasAccess: true, wishlist };
  }

  // Private wishlists require authentication
  if (!userId) {
    return { hasAccess: false };
  }

  // Owner always has access
  if (wishlist.owner.toString() === userId) {
    return { hasAccess: true, wishlist };
  }

  // Check membership
  const membership = await WishlistMember.findOne({
    wishlist: wishlistId,
    user: userId,
  });

  return { hasAccess: !!membership, wishlist };
}

// GET /api/wishlists/[id]/items - Get all items for a wishlist
// Admin and public users don't see bookedBy to avoid spoiling surprises
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id: wishlistId } = await params;

    await connectDB();

    // Check access to wishlist
    const { hasAccess, wishlist } = await checkWishlistAccess(
      wishlistId,
      session?.user?.id
    );

    if (!hasAccess || !wishlist) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No access to this wishlist' },
        { status: 403 }
      );
    }

    const items = await Item.find({ wishlist: wishlistId }).sort({ createdAt: -1 });

    // Check if user is owner or member
    const isOwner = session?.user && wishlist.owner.toString() === session.user.id;
    let isMember = false;
    if (session?.user && !isOwner) {
      const membership = await WishlistMember.findOne({
        wishlist: wishlistId,
        user: session.user.id,
      });
      isMember = !!membership;
    }

    // Filter out draft items for non-owners
    // Filter out proposed items except for owner and proposer
    const visibleItems = items.filter((item) => {
      if (item.status === 'draft') {
        return isOwner; // Only owners can see draft items
      }
      if (item.status === 'proposed') {
        // Only owner and proposer can see proposed items
        if (isOwner) return true;
        if (session?.user && item.proposedBy?.toString() === session.user.id) return true;
        return false;
      }
      return true;
    });

    // Filter items based on user role
    const filteredItems = visibleItems.map((item) => {
      const itemObj = item.toObject();

      if (!session?.user) {
        // Public users: hide booking details completely
        // Public users: hide proposedBy completely
        if (itemObj.status === 'booked') {
          return {
            ...itemObj,
            status: 'available', // Show as available to avoid spoiling
            bookedBy: undefined,
            proposedBy: undefined,
          };
        }
        return { 
          ...itemObj, 
          bookedBy: undefined,
          proposedBy: undefined,
        };
      }

      if (isOwner) {
        // Owner: CANNOT see which items are booked (hide booking info)
        // Owner: CANNOT see who proposed items (hide proposedBy info)
        if (itemObj.status === 'booked') {
          return {
            ...itemObj,
            status: 'available', // Show as available
            bookedBy: undefined,
            proposedBy: undefined, // Hide who proposed the item
          };
        }
        return { 
          ...itemObj, 
          bookedBy: undefined,
          proposedBy: undefined, // Hide who proposed the item
        };
      }

      if (isMember) {
        // Member: CAN see which items are booked (status shows as 'booked')
        // Can see if THEY booked it (bookedBy shows their ID)
        // Can see if THEY proposed it (proposedBy shows their ID)
        const isBookedByMe = itemObj.bookedBy?.toString() === session.user.id;
        const isProposedByMe = itemObj.proposedBy?.toString() === session.user.id;
        return {
          ...itemObj,
          // Keep status as 'booked' so members can see which items are booked
          bookedBy: isBookedByMe ? session.user.id : undefined, // Only show if current user booked it
          proposedBy: isProposedByMe ? session.user.id : undefined, // Only show if current user proposed it
        };
      }

      // Not a member: hide booking details and proposedBy
      if (itemObj.status === 'booked') {
        return {
          ...itemObj,
          status: 'available',
          bookedBy: undefined,
          proposedBy: undefined,
        };
      }
      return { 
        ...itemObj, 
        bookedBy: undefined,
        proposedBy: undefined,
      };
    });

    return NextResponse.json({ success: true, data: filteredItems }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

// POST /api/wishlists/[id]/items - Create a new item
// Owners can create items with any status (draft/available)
// Members can only create items with 'proposed' status
export async function POST(
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
    const { id: wishlistId } = await params;

    const wishlist = await Wishlist.findById(wishlistId);
    if (!wishlist) {
      return NextResponse.json(
        { success: false, error: 'Wishlist not found' },
        { status: 404 }
      );
    }

    const isOwner = wishlist.owner.toString() === session.user.id;
    
    // Check if user is owner or member
    let isMember = false;
    if (!isOwner) {
      const membership = await WishlistMember.findOne({
        wishlist: wishlistId,
        user: session.user.id,
      });
      isMember = !!membership;
    }

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner or member access required' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, createItemSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const { name, imageUrl, priceInCents, link, notes, status, bookedBy } = validation.data;

    // Members can only create proposed items
    if (!isOwner && status !== 'proposed') {
      return NextResponse.json(
        { success: false, error: 'Members can only propose items (status must be "proposed")' },
        { status: 403 }
      );
    }

    // Owners cannot create proposed items (they create draft/available directly)
    if (isOwner && status === 'proposed') {
      return NextResponse.json(
        { success: false, error: 'Owners cannot create proposed items' },
        { status: 400 }
      );
    }

    interface ItemCreateData {
      wishlist: string;
      name: string;
      imageUrl?: string;
      priceInCents?: number;
      link?: string;
      notes?: string;
      status: string;
      bookedBy: mongoose.Types.ObjectId | null;
      proposedBy?: mongoose.Types.ObjectId;
    }

    const itemData: ItemCreateData = {
      wishlist: wishlistId,
      name,
      imageUrl,
      priceInCents,
      link,
      notes,
      status: status || 'available',
      bookedBy: bookedBy ? new mongoose.Types.ObjectId(bookedBy) : null,
    };

    // Set proposedBy for proposed items
    if (status === 'proposed') {
      itemData.proposedBy = new mongoose.Types.ObjectId(session.user.id);
    }

    const item = await Item.create(itemData);

    return NextResponse.json({ success: true, data: item }, { status: 201 });
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create item' },
      { status: 500 }
    );
  }
}

