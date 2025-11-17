import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember, { IWishlistMember } from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import { updateWishlistSchema, validateRequestBody } from '@/lib/validations';

// Helper function to check if user has permission
async function checkWishlistPermission(
  wishlistId: string,
  userId: string,
  requireOwner: boolean = false
): Promise<{
  hasAccess: boolean;
  membership?: IWishlistMember | { role: 'owner' };
  wishlist?: IWishlist;
}> {
  await connectDB();

  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) {
    return { hasAccess: false };
  }

  // Owner always has access
  if (wishlist.owner.toString() === userId) {
    return { hasAccess: true, wishlist, membership: { role: 'owner' } };
  }

  // If owner is required, deny access
  if (requireOwner) {
    return { hasAccess: false };
  }

  // Check membership
  const membership = await WishlistMember.findOne({
    wishlist: wishlistId,
    user: userId,
  });

  return { hasAccess: !!membership, membership: membership || undefined, wishlist };
}

// GET /api/wishlists/[id] - Get a specific wishlist
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;

    await connectDB();

    const wishlist = await Wishlist.findById(id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Fetch owner email
    const owner = await User.findById(wishlist.owner).select('email');
    const ownerEmail = owner?.email || null;

    // Public wishlists can be viewed by anyone
    if (wishlist.isPublic) {
      // If user is authenticated, add role info
      if (session?.user) {
        const isOwner = wishlist.owner.toString() === session.user.id;
        const membership = await WishlistMember.findOne({
          wishlist: id,
          user: session.user.id,
        });
        const isMember = !!membership && !isOwner;

        return NextResponse.json(
          {
            success: true,
            data: {
              ...wishlist.toObject(),
              userRole: isOwner ? 'owner' : isMember ? 'member' : null,
              ownerEmail,
            },
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          success: true,
          data: {
            ...wishlist.toObject(),
            ownerEmail,
          },
        },
        { status: 200 }
      );
    }

    // Private wishlists require authentication
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - This wishlist is private' },
        { status: 401 }
      );
    }

    const { hasAccess, membership } = await checkWishlistPermission(id, session.user.id);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No access to this wishlist' },
        { status: 403 }
      );
    }

    // Add user role info to response
    const isOwner = wishlist.owner.toString() === session.user.id;
    const isMember = !!membership && !isOwner;

    return NextResponse.json(
      {
        success: true,
        data: {
          ...wishlist.toObject(),
          userRole: isOwner ? 'owner' : isMember ? 'member' : null,
          ownerEmail,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch wishlist' },
      { status: 500 }
    );
  }
}

// PATCH /api/wishlists/[id] - Update a wishlist (owner only)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { hasAccess, membership, wishlist } = await checkWishlistPermission(
      id,
      session.user.id,
      true // require owner
    );

    if (!hasAccess || !wishlist) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, updateWishlistSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const updateData: Partial<Pick<IWishlist, 'name' | 'description' | 'isPublic'>> = {};
    const validatedData = validation.data;
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.description !== undefined) updateData.description = validatedData.description;
    if (validatedData.isPublic !== undefined) updateData.isPublic = validatedData.isPublic;

    const updatedWishlist = await Wishlist.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    return NextResponse.json({ success: true, data: updatedWishlist }, { status: 200 });
  } catch (error) {
    console.error('Error updating wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update wishlist' },
      { status: 500 }
    );
  }
}

// DELETE /api/wishlists/[id] - Delete a wishlist (owner only)
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

    const wishlist = await Wishlist.findById(id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Only owner can delete
    if (wishlist.owner.toString() !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Only owner can delete wishlist' },
        { status: 403 }
      );
    }

    // Delete all items in this wishlist
    await Item.deleteMany({ wishlist: id });

    // Delete all memberships
    await WishlistMember.deleteMany({ wishlist: id });

    // Delete wishlist
    await Wishlist.findByIdAndDelete(id);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete wishlist' },
      { status: 500 }
    );
  }
}
