import { NextRequest, NextResponse } from 'next/server';
import mongoose, { type UpdateQuery } from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import User from '@/models/User';
import Item from '@/models/Item';
import { updateWishlistSchema, validateRequestBody } from '@/lib/validations';
import {
  canAttachImage,
  deleteOwnBlob,
  deleteOwnBlobs,
  FOREIGN_IMAGE_ERROR,
  freeReplacedImage,
  isSameImage,
} from '@/lib/utils/blob';
import {
  resolveWishlistId,
  generateUniqueWishlistSlug,
  isReservedWishlistSlug,
} from '@/lib/utils/wishlistSlug';
import { getOwnerAccess, getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import {
  ownedByFilter,
  ownerIds,
  primaryOwnerId,
  serializeWishlist,
} from '@/lib/utils/wishlistOwners';
import { purgeShareCards } from '@/lib/og/purge';
import { enforce, userKey } from '@/lib/rateLimit';

/**
 * The settings a list's share card depends on: its name, banner and owner, and
 * whether a signed-out visitor may open it (visibility, archived). The URL too,
 * since a renamed slug leaves the old one's cached card naming the list.
 */
const SHARE_CARD_FIELDS = ['name', 'slug', 'visibility', 'archived', 'bannerUrl'] as const;

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

    // Fetch owners' public usernames (never expose their emails to viewers).
    // `ownerUsernames` is ordered like `owners`, so [0] is the primary owner.
    const owners = ownerIds(wishlist);
    const ownerUsers = await User.find({ _id: { $in: owners } }).select('username');
    const usernameById = new Map(ownerUsers.map((u) => [u._id.toString(), u.username]));
    const ownerUsernames = owners.map((id) => usernameById.get(id)).filter((u): u is string => !!u);
    const primaryId = primaryOwnerId(wishlist);
    const ownerUsername = (primaryId && usernameById.get(primaryId)) || null;

    // Archived (owners only), visibility tier, membership, any owner's friends:
    // the same rules as the items read, so the list and its items agree.
    const access = await getWishlistViewAccess(wishlist, session?.user?.id);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    let userRole: 'owner' | 'member' | null = null;
    if (access.isOwner) userRole = 'owner';
    else if (access.isMember) userRole = 'member';

    // Lazily backfill a slug for legacy wishlists created before slugs existed.
    // Only once access is granted, so a refused viewer writes nothing, and only
    // the slug: a `save()` of the hydrated doc would also store any schema
    // default that hydration filled in for a field the stored list lacks.
    // Not a content edit, so `updatedAt` stays put. It only fills a slug that's
    // still missing: one set since our read (an owner's rename of the URL,
    // another viewer's backfill) is kept, and that's the one we answer with.
    if (!wishlist.slug) {
      const slug = await generateUniqueWishlistSlug(wishlist.name);
      const { modifiedCount } = await Wishlist.updateOne(
        { _id: wishlist._id, slug: { $in: [null, ''] } },
        { $set: { slug } },
        { timestamps: false }
      );
      wishlist.slug = modifiedCount
        ? slug
        : (await Wishlist.findById(wishlist._id).select('slug').lean())?.slug;
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

    // An archived list comes back as no list at all to anyone but its owners, so
    // they get the 404 of a list that doesn't exist (see `getOwnerAccess`).
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
        | 'occasion'
      >
    > = {};
    const validatedData = validation.data;
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.description !== undefined) updateData.description = validatedData.description;
    if (validatedData.bannerUrl !== undefined) {
      if (!canAttachImage(validatedData.bannerUrl, session.user.id, wishlist.bannerUrl)) {
        return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
      }
      // The banner the list already has isn't written back: that would undo a
      // co-owner's replacement landing after the read above, and restore the
      // banner their edit had already freed.
      if (!isSameImage(validatedData.bannerUrl, wishlist.bannerUrl)) {
        updateData.bannerUrl = validatedData.bannerUrl || null;
      }
    }
    if (validatedData.currency !== undefined) updateData.currency = validatedData.currency;

    // Slug: validate reserved + uniqueness before applying.
    if (validatedData.slug !== undefined && validatedData.slug !== wishlist.slug) {
      // Slugs are unique across every list, so the 409 below confirms that some
      // list holds a slug, even one the caller can't open. That's accepted (an
      // owner-chosen slug is a public URL), but trying one costs a token, and
      // only here: the caller is known to own this list, and an edit that leaves
      // the URL alone never spends one.
      const limited = await enforce('wishlistSlug', userKey(session.user.id));
      if (limited) return limited;
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
    // Set, changed or (null) cleared in the same write as the rest of the edit.
    if (validatedData.occasion !== undefined) updateData.occasion = validatedData.occasion;

    // "Featured" pins a list to the *caller's* dashboard hero, so it's stored
    // per-owner in `featuredBy`: on a co-owned list one owner can feature it
    // without touching anyone else's dashboard.
    const viewer = new mongoose.Types.ObjectId(session.user.id);
    const update: UpdateQuery<IWishlist> = { $set: updateData };
    if (validatedData.featured === true) update.$addToSet = { featuredBy: viewer };
    if (validatedData.featured === false) update.$pull = { featuredBy: viewer };

    // The whole edit is one write that only matches while the caller still owns
    // the list. The check above ran against the list as it was read at the start
    // of the request, and a co-owner may have removed the caller since: someone
    // who no longer owns the list can't change it, or pin it back onto their
    // dashboard after losing ownership cleared their pin. An edit that replaces
    // or clears the banner frees the one it replaced, so its write hands back the
    // list as it was just before it landed.
    const replacesBanner = updateData.bannerUrl !== undefined;
    const written = await Wishlist.findOneAndUpdate(
      { _id: id, ...ownedByFilter(session.user.id) },
      update,
      { returnDocument: replacesBanner ? 'before' : 'after', runValidators: true }
    );
    if (!written) {
      // Nothing was written, so this read only picks the answer: the list is
      // gone (or archived, which looks the same to anyone but its owners), or the
      // caller doesn't own it (any more).
      if (!(await getOwnerAccess(id, session.user.id)).wishlist) {
        return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
      }
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    // A change to anything the list's share card shows drops the cached card, now
    // that it has landed (lib/og/purge.ts).
    if (SHARE_CARD_FIELDS.some((field) => field in updateData)) {
      await purgeShareCards({ wishlistIds: [id] });
    }

    // At most one of the caller's lists is pinned at a time, so unpin whichever
    // other one was. Only once the pin above landed, so a refused edit leaves
    // their other pin alone.
    if (validatedData.featured === true) {
      await Wishlist.updateMany(
        { featuredBy: viewer, _id: { $ne: id } },
        { $pull: { featuredBy: viewer } }
      );
    }

    let updatedWishlist = written;
    if (replacesBanner) {
      // Free the banner this write replaced: the one the list had as it landed,
      // not the one read above. A co-owner replacing it in between has freed
      // that one already, and nothing else would free theirs.
      await freeReplacedImage(written.bannerUrl, updateData.bannerUrl);
      // Answered with the list as it is now. One deleted since this write landed
      // is answered like any other missing list.
      const now = await Wishlist.findById(id);
      if (!now) {
        return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
      }
      updatedWishlist = now;
    }

    return NextResponse.json(
      { success: true, data: serializeWishlist(updatedWishlist, session.user.id) },
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
      // deleted the list first (or it's archived, which looks the same to anyone
      // but its owners), or the caller doesn't own it (any more).
      if (!(await getOwnerAccess(id, session.user.id)).wishlist) {
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
    //    `wishlist_invite` ones even look actionable). One that a request
    //    already past its checks writes after this is taken back by
    //    `createNotification(s)` (lib/notifications.ts), which re-checks the
    //    list once it's written.
    //  - Our own uploaded cover image.
    // Reservations and gift logs deliberately stay: they're the gifter's, so
    // they can still see what they claimed and log the gift.
    await Promise.all([
      bestEffort('Item', id, () => deleteItemsAndImages(id)),
      bestEffort('Membership', id, () => WishlistMember.deleteMany({ wishlist: id })),
      bestEffort('Invite', id, () => WishlistInvite.deleteMany({ wishlist: id })),
      bestEffort('Notification', id, () => Notification.deleteMany({ wishlist: id })),
      deleteOwnBlob(wishlist.bannerUrl),
      // Its cached share card, which would otherwise go on naming it for a day.
      purgeShareCards({ wishlistIds: [id] }),
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
