import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
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
  ownedByFilter,
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

/** Run one cleanup step after a wishlist delete; log and swallow a failure. */
async function bestEffort(
  what: string,
  wishlistId: string,
  step: () => PromiseLike<unknown>
): Promise<void> {
  try {
    await step();
  } catch (err) {
    console.error(`${what} cleanup failed for deleted wishlist ${wishlistId}:`, err);
  }
}

/** Delete a deleted list's items, then free the images uploaded for them. */
async function deleteItemsAndImages(wishlistId: string): Promise<void> {
  // Collected before the items go, or their blobs would be orphaned in storage.
  const items = await Item.find({ wishlist: wishlistId }).select('imageUrl').lean();
  await Item.deleteMany({ wishlist: wishlistId });
  await deleteOwnBlobs(items.map((i) => i.imageUrl));
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

    // Only an owner can delete, and the delete is its own ownership check: it
    // only matches while the caller still owns the list. A check against a copy
    // read earlier would race: a co-owner removing the caller a moment before
    // wouldn't stop it. So the list goes first, and nothing else is touched
    // unless it did.
    const wishlist = await Wishlist.findOneAndDelete({
      _id: id,
      ...ownedByFilter(session.user.id),
    });
    if (!wishlist) {
      // Nothing was deleted, so this read only picks the answer: another owner
      // deleted the list first, or the caller doesn't own it (any more).
      if (!(await Wishlist.exists({ _id: id }))) {
        return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
      }
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Only an owner can delete wishlist' },
        { status: 403 }
      );
    }

    // Best-effort cleanup of what only made sense while the list existed. The
    // list is already gone, so each step logs and continues: a failure here
    // must not turn a successful delete into an error. Whatever a failed step
    // leaves behind points at a list that no longer exists, so nothing can
    // reach it.
    //  - Items, and their uploaded images.
    //  - Memberships.
    //  - Invites, whatever their status (accepted/declined rows are only
    //    history for a list that no longer exists).
    //  - Notifications that link to the list, which would now 404 (the
    //    `wishlist_invite` ones even look actionable).
    //  - Our own uploaded cover image.
    // Reservations and gift logs deliberately stay: they're the gifter's, so
    // they can still see what they claimed and log the gift.
    await Promise.all([
      bestEffort('Item', id, () => deleteItemsAndImages(id)),
      bestEffort('Membership', id, () => WishlistMember.deleteMany({ wishlist: id })),
      bestEffort('Invite', id, () => WishlistInvite.deleteMany({ wishlist: id })),
      bestEffort('Notification', id, () => Notification.deleteMany({ wishlist: id })),
      deleteOwnBlob(wishlist.bannerUrl),
    ]);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete wishlist' },
      { status: 500 }
    );
  }
}
