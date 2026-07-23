import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import { updateWishlistSchema, validateRequestBody } from '@/lib/validations';
import { areFriends } from '@/lib/utils/friends';
import {
  resolveWishlistId,
  generateUniqueWishlistSlug,
  isReservedWishlistSlug,
} from '@/lib/utils/wishlistSlug';
import { getAdminOrOwnerAccess } from '@/lib/utils/wishlistAccess';

// GET /api/wishlists/[id] - Get a specific wishlist
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id: idParam } = await params;

    await connectDB();

    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Lazily backfill a slug for legacy wishlists created before slugs existed.
    if (!wishlist.slug) {
      wishlist.slug = await generateUniqueWishlistSlug(wishlist.name);
      await wishlist.save();
    }

    // Fetch owner's public username (never expose their email to viewers)
    const owner = await User.findById(wishlist.owner).select('username');
    const ownerUsername = owner?.username || null;

    const visibility = wishlist.visibility || (wishlist.isPublic ? 'everyone' : 'private');

    // Resolve the viewer's relationship to the wishlist
    const isOwner = !!session?.user && wishlist.owner.toString() === session.user.id;

    // Archived wishlists are visible to the owner only — hide from everyone else
    // (return 404 so the URL doesn't even reveal that it exists).
    if (wishlist.archived && !isOwner) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const membership =
      session?.user && !isOwner
        ? await WishlistMember.findOne({ wishlist: id, user: session.user.id })
        : null;
    let userRole: 'owner' | 'admin' | 'member' | null = null;
    if (isOwner) userRole = 'owner';
    else if (membership) userRole = membership.role === 'admin' ? 'admin' : 'member';

    // Determine access by visibility tier
    let hasAccess = false;
    if (visibility === 'everyone') {
      hasAccess = true;
    } else {
      // friends / private require a session
      if (!session?.user) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized - This wishlist is private' },
          { status: 401 }
        );
      }
      hasAccess = isOwner || !!membership;
      if (!hasAccess && visibility === 'friends') {
        hasAccess = await areFriends(session.user.id, wishlist.owner.toString());
      }
    }

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No access to this wishlist' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          ...wishlist.toObject(),
          userRole,
          ownerUsername,
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
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const { hasAccess, wishlist } = await getAdminOrOwnerAccess(id, session.user.id);

    if (!hasAccess || !wishlist) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin or owner access required' },
        { status: 403 }
      );
    }

    const isOwner = wishlist.owner.toString() === session.user.id;

    // Validate request body
    const validation = await validateRequestBody(request, updateWishlistSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const updateData: Partial<
      Pick<
        IWishlist,
        | 'name'
        | 'slug'
        | 'description'
        | 'isPublic'
        | 'visibility'
        | 'archived'
        | 'featured'
        | 'bannerUrl'
        | 'currency'
      >
    > = {};
    const validatedData = validation.data;
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.description !== undefined) updateData.description = validatedData.description;
    if (validatedData.bannerUrl !== undefined) updateData.bannerUrl = validatedData.bannerUrl || null;
    if (validatedData.currency !== undefined) updateData.currency = validatedData.currency;

    // Slug: validate reserved + uniqueness before applying.
    if (validatedData.slug !== undefined && validatedData.slug !== wishlist.slug) {
      const slug = validatedData.slug;
      if (isReservedWishlistSlug(slug)) {
        return NextResponse.json(
          { success: false, error: 'That URL is reserved. Please choose another.' },
          { status: 409 }
        );
      }
      const taken = await Wishlist.exists({ slug, _id: { $ne: id } });
      if (taken) {
        return NextResponse.json(
          { success: false, error: 'That URL is already taken.' },
          { status: 409 }
        );
      }
      updateData.slug = slug;
    }
    if (validatedData.visibility !== undefined) {
      updateData.visibility = validatedData.visibility;
      updateData.isPublic = validatedData.visibility === 'everyone';
    }
    if (validatedData.archived !== undefined) updateData.archived = validatedData.archived;

    // "Featured" pins a list to the owner's dashboard hero. Only the owner may
    // set it, and at most one of their lists can be featured at a time.
    if (validatedData.featured !== undefined) {
      if (!isOwner) {
        return NextResponse.json(
          { success: false, error: 'Only the owner can feature a wishlist' },
          { status: 403 }
        );
      }
      updateData.featured = validatedData.featured;
      if (validatedData.featured === true) {
        await Wishlist.updateMany(
          { owner: session.user.id, _id: { $ne: id } },
          { $set: { featured: false } }
        );
      }
    }

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
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

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
