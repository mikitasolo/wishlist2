import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import { updateWishlistSchema, validateRequestBody } from '@/lib/validations';
import { areFriends } from '@/lib/utils/friends';
import {
  canAttachImage,
  deleteOwnBlob,
  deleteOwnBlobs,
  FOREIGN_IMAGE_ERROR,
} from '@/lib/utils/blob';
import {
  resolveWishlistId,
  generateUniqueWishlistSlug,
  isReservedWishlistSlug,
} from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import {
  isWishlistOwner,
  ownerIds,
  primaryOwnerId,
  serializeWishlist,
} from '@/lib/utils/wishlistOwners';

// GET /api/wishlists/[id] - Get a specific wishlist
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
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

    // Fetch owners' public usernames (never expose their emails to viewers).
    // `ownerUsernames` is ordered like `owners`, so [0] is the primary owner.
    const owners = ownerIds(wishlist);
    const ownerUsers = await User.find({ _id: { $in: owners } }).select('username');
    const usernameById = new Map(ownerUsers.map((u) => [u._id.toString(), u.username]));
    const ownerUsernames = owners.map((id) => usernameById.get(id)).filter((u): u is string => !!u);
    const primaryId = primaryOwnerId(wishlist);
    const ownerUsername = (primaryId && usernameById.get(primaryId)) || null;

    const visibility = wishlist.visibility || (wishlist.isPublic ? 'everyone' : 'private');

    // Resolve the viewer's relationship to the wishlist. Every co-owner is an
    // owner here — same authorization, same booking blindness.
    const isOwner = isWishlistOwner(wishlist, session?.user?.id);

    // Archived wishlists are visible to owners only — hide from everyone else
    // (return 404 so the URL doesn't even reveal that it exists).
    if (wishlist.archived && !isOwner) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const membership =
      session?.user && !isOwner
        ? await WishlistMember.findOne({ wishlist: id, user: session.user.id })
        : null;
    let userRole: 'owner' | 'member' | null = null;
    if (isOwner) userRole = 'owner';
    else if (membership) userRole = 'member';

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
        // A co-owned list behaves as if each owner created it, so the friends
        // tier admits any owner's friends.
        const viewerId = session.user.id;
        const friendChecks = await Promise.all(owners.map((id) => areFriends(viewerId, id)));
        hasAccess = friendChecks.some(Boolean);
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
          ...serializeWishlist(wishlist, session?.user?.id ?? null),
          userRole,
          ownerUsername,
          ownerUsernames,
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
    const session = await auth();

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

    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);

    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) {
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

    const updateData: Partial<
      Pick<
        IWishlist,
        | 'name'
        | 'slug'
        | 'description'
        | 'isPublic'
        | 'visibility'
        | 'archived'
        | 'bannerUrl'
        | 'currency'
      >
    > = {};
    const validatedData = validation.data;
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.description !== undefined) updateData.description = validatedData.description;
    if (validatedData.bannerUrl !== undefined) {
      if (!canAttachImage(validatedData.bannerUrl, session.user.id, wishlist.bannerUrl)) {
        return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
      }
      updateData.bannerUrl = validatedData.bannerUrl || null;
    }
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

    // "Featured" pins a list to the *caller's* dashboard hero, so it's stored
    // per-owner in `featuredBy`: on a co-owned list one owner can feature it
    // without touching anyone else's dashboard. At most one of their lists is
    // pinned at a time.
    if (validatedData.featured !== undefined) {
      const viewer = new mongoose.Types.ObjectId(session.user.id);
      if (validatedData.featured) {
        // Unpin whichever of the caller's other lists was pinned.
        await Wishlist.updateMany(
          { featuredBy: viewer, _id: { $ne: id } },
          { $pull: { featuredBy: viewer } }
        );
        await Wishlist.updateOne({ _id: id }, { $addToSet: { featuredBy: viewer } });
      } else {
        await Wishlist.updateOne({ _id: id }, { $pull: { featuredBy: viewer } });
      }
    }

    const updatedWishlist = await Wishlist.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    // Free the previous cover image if this edit replaced or cleared it.
    if (updateData.bannerUrl !== undefined && wishlist.bannerUrl !== updateData.bannerUrl) {
      await deleteOwnBlob(wishlist.bannerUrl);
    }

    return NextResponse.json(
      {
        success: true,
        data: updatedWishlist ? serializeWishlist(updatedWishlist, session.user.id) : null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update wishlist' },
      { status: 500 }
    );
  }
}

// DELETE /api/wishlists/[id] - Delete a wishlist (any owner; owners are equal)
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
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Only an owner can delete.
    if (!isWishlistOwner(wishlist, session.user.id)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Only an owner can delete wishlist' },
        { status: 403 }
      );
    }

    // Collect uploaded item images before deleting the items, so we can free
    // their blobs afterwards (otherwise they'd be orphaned in storage).
    const items = await Item.find({ wishlist: id }).select('imageUrl').lean();

    // Delete all items in this wishlist
    await Item.deleteMany({ wishlist: id });

    // Delete all memberships
    await WishlistMember.deleteMany({ wishlist: id });

    // Delete wishlist
    await Wishlist.findByIdAndDelete(id);

    // Best-effort cleanup of our own uploaded blobs (item images + cover).
    await deleteOwnBlobs([...items.map((i) => i.imageUrl), wishlist.bannerUrl]);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete wishlist' },
      { status: 500 }
    );
  }
}
