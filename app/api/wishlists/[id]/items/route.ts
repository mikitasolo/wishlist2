import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { createItemSchema, validateRequestBody } from '@/lib/validations';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { itemPriceInUsdCents } from '@/lib/utils/itemPrice';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { createNotifications } from '@/lib/notifications';
import { isWishlistOwner, ownerIds } from '@/lib/utils/wishlistOwners';
import { getWishlistViewAccess, isHiddenByArchive } from '@/lib/utils/wishlistAccess';
import {
  canAttachImage,
  copyBlobToUploads,
  deleteOwnBlob,
  FOREIGN_IMAGE_ERROR,
  isOwnBlob,
} from '@/lib/utils/blob';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { itemsGivenBy } from '@/lib/utils/giftHistory';
import {
  canCopyItem,
  COPY_IMAGE_FAILED_NOTICE,
  COPY_IMAGE_QUOTA_NOTICE,
} from '@/lib/utils/itemCopy';
import { isCountedOnShareCard } from '@/lib/og/data';
import { purgeShareCards } from '@/lib/og/purge';

/**
 * The item a "Save to my list" copy is made from, if `viewerId` may copy it:
 * it's on a list they can open right now (`getWishlistViewAccess`, the rules
 * the list and its items are read with), and `canCopyItem` allows it (not a
 * draft, nor someone else's proposal). Null otherwise, and the caller answers
 * every null with the same 404, so a refusal tells them nothing a missing item
 * wouldn't: not that a list they can't see exists, nor that an item is a draft.
 */
async function findCopySource(sourceItemId: string, viewerId: string) {
  if (!isObjectIdParam(sourceItemId)) return null;
  const source = await Item.findById(sourceItemId);
  if (!source || !canCopyItem(source, viewerId)) return null;
  const sourceList = await Wishlist.findById(source.wishlist);
  if (!sourceList) return null;
  const access = await getWishlistViewAccess(sourceList, viewerId);
  return access.allowed ? source : null;
}

// GET /api/wishlists/[id]/items - Get all items for a wishlist
// Owners and public users don't see bookedBy to avoid spoiling surprises
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const { id: idParam } = await params;
    const wishlistId = await resolveWishlistId(idParam);
    if (!wishlistId) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    await connectDB();

    const wishlist = await Wishlist.findById(wishlistId);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Exactly the rules of GET /api/wishlists/[id] (archived → 404 for non-owners,
    // visibility tier, membership, any owner's friends), so the items are never
    // readable by someone the list itself is hidden from, or vice versa.
    const access = await getWishlistViewAccess(wishlist, session?.user?.id);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // Ensure currency rates are up to date
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates || new Map<string, number>();

    const items = await Item.find({ wishlist: wishlistId }).sort({ createdAt: -1 });

    // Every co-owner counts as owner — which is also what keeps bookings hidden
    // from all of them below.
    const { isOwner, isMember } = access;

    // Drafts are owner-only; a proposal is visible to the owners and its proposer.
    const visibleItems = items.filter((item) => {
      if (item.status === 'draft') {
        return isOwner;
      }
      if (item.status === 'proposed') {
        if (isOwner) return true;
        if (session?.user && item.proposedBy?.toString() === session.user.id) return true;
        return false;
      }
      return true;
    });

    // A member's own gifts: of the items they hold the booking of, the ones
    // they've since marked as given, from their own gift history. The card shows
    // those as "Given by you" rather than offering an Unbook that would put a
    // gift already given back up for someone else to buy. Read only for a member
    // who isn't an owner, and only for their own bookings: nothing of it reaches
    // an owner (booking-blind; `isMember` never includes one), a visitor, or
    // anyone else's bookings.
    const viewerId = session?.user?.id;
    const givenByViewer =
      viewerId && isMember
        ? await itemsGivenBy(
            viewerId,
            visibleItems
              .filter((item) => item.status === 'booked' && item.bookedBy?.toString() === viewerId)
              .map((item) => item._id)
          )
        : new Set<string>();

    // Filter items based on user role and enrich with priceInUsdCents
    const filteredItems = visibleItems.map((item) => {
      const itemObj = item.toObject();

      const enrichedItem = {
        ...itemObj,
        priceInUsdCents: itemPriceInUsdCents(itemObj.price, rates),
      };

      if (!session?.user) {
        // Public users: hide booking details completely
        // Public users: hide proposedBy completely
        if (itemObj.status === 'booked') {
          return {
            ...enrichedItem,
            status: 'available', // Show as available to avoid spoiling
            bookedBy: undefined,
            proposedBy: undefined,
          };
        }
        return {
          ...enrichedItem,
          bookedBy: undefined,
          proposedBy: undefined,
        };
      }

      if (isOwner) {
        // Owners CANNOT see which items are booked (hide booking info)
        // Owners CANNOT see who proposed items (hide proposedBy info)
        if (itemObj.status === 'booked') {
          return {
            ...enrichedItem,
            status: 'available', // Show as available
            bookedBy: undefined,
            proposedBy: undefined, // Hide who proposed the item
          };
        }
        return {
          ...enrichedItem,
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
          ...enrichedItem,
          // Keep status as 'booked' so members can see which items are booked
          bookedBy: isBookedByMe ? session.user.id : undefined, // Only show if current user booked it
          proposedBy: isProposedByMe ? session.user.id : undefined, // Only show if current user proposed it
          // Only ever true on an item they booked themselves (see givenByViewer).
          givenByMe: isBookedByMe && givenByViewer.has(itemObj._id.toString()),
        };
      }

      // Not a member: hide booking details and proposedBy
      if (itemObj.status === 'booked') {
        return {
          ...enrichedItem,
          status: 'available',
          bookedBy: undefined,
          proposedBy: undefined,
        };
      }
      return {
        ...enrichedItem,
        bookedBy: undefined,
        proposedBy: undefined,
      };
    });

    return NextResponse.json({ success: true, data: filteredItems }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch items' }, { status: 500 });
  }
}

// POST /api/wishlists/[id]/items - Create a new item
// Owners create draft/available items; members can only propose.
// A new item is never booked: a client-sent `bookedBy` is dropped by the schema.
// With `sourceItemId`, an owner saves a copy of an item they can see ("Save to
// my list"): the fields are the ones sent, and the source's image blob, if sent
// back unchanged, is copied into the caller's own uploads (see findCopySource).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    // Throttle content creation (owner items + member proposals) to stop bulk junk.
    const limited = await enforce('content', userKey(session.user.id));
    if (limited) return limited;

    await connectDB();
    const { id: idParam } = await params;
    const wishlistId = await resolveWishlistId(idParam);
    if (!wishlistId) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(wishlistId);
    // An archived list is owner-only, so a member can't propose to it: answered
    // exactly like a missing list, as viewing it is.
    if (!wishlist || isHiddenByArchive(wishlist, session.user.id)) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    const isOwner = isWishlistOwner(wishlist, session.user.id);

    let isMember = false;
    if (!isOwner) {
      isMember = !!(await WishlistMember.findOne({
        wishlist: wishlistId,
        user: session.user.id,
      }));
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

    const { name, imageUrl, price, link, notes, mostWanted, status, sourceItemId } =
      validation.data;
    const isCopy = sourceItemId !== undefined;

    // Covers owner-created items and member proposals alike. A copy's image is
    // checked against its source, below.
    if (!isCopy && !canAttachImage(imageUrl, session.user.id)) {
      return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
    }

    // Ensure currency rates are up to date for validation
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates || new Map<string, number>();

    // Validate currency exists in rates if price is provided
    if (price && price.currency) {
      const currencyLower = price.currency.toLowerCase(); // Already lowercase from validation, but ensure it
      if (!rates.has(currencyLower)) {
        return NextResponse.json(
          {
            success: false,
            error: `Currency '${price.currency}' is not supported. Please use a supported currency code.`,
          },
          { status: 400 }
        );
      }
    }

    // Members can only propose; owners create draft/available directly.
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

    // "Save to my list": a copy goes into a list of your own (members only ever
    // propose). Checked last, after everything cheaper that can refuse it, and
    // so is the image copy: a refused request never leaves a copied blob behind.
    let storedImageUrl = imageUrl;
    let copiedImageUrl: string | undefined;
    let notice: string | undefined;
    if (isCopy) {
      if (!isOwner) {
        return NextResponse.json(
          { success: false, error: 'Only owners can save an item to this list' },
          { status: 403 }
        );
      }
      const source = await findCopySource(sourceItemId, session.user.id);
      if (!source) {
        return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
      }

      if (imageUrl && imageUrl === source.imageUrl && isOwnBlob(imageUrl)) {
        // The source's own blob (whoever uploaded it, the caller included) is
        // copied, never shared: deleting either item frees its image. A copy
        // that can't be made (no quota left, or the store failed) doesn't fail
        // the save: the item is saved without an image, and the reply says why.
        const copied = await copyBlobToUploads(imageUrl, session.user.id);
        if (copied.ok) {
          storedImageUrl = copiedImageUrl = copied.url;
        } else {
          storedImageUrl = undefined;
          notice = copied.reason === 'quota' ? COPY_IMAGE_QUOTA_NOTICE : COPY_IMAGE_FAILED_NOTICE;
        }
      } else if (!canAttachImage(imageUrl, session.user.id)) {
        // Someone else's blob that isn't the source's image, typically the one
        // the source had when the form was filled, replaced since. Never
        // attached, as anywhere else; the copy is saved without it.
        storedImageUrl = undefined;
        notice = COPY_IMAGE_FAILED_NOTICE;
      }
      // Otherwise it's the caller's own upload or an external URL, which we
      // never delete, so it's kept as it is.
    }

    interface ItemCreateData {
      wishlist: string;
      name: string;
      imageUrl?: string;
      price?: {
        value: number;
        currency: string;
      } | null;
      link?: string;
      notes?: string;
      mostWanted: boolean;
      status: string;
      bookedBy: null;
      proposedBy?: mongoose.Types.ObjectId;
    }

    const itemData: ItemCreateData = {
      wishlist: wishlistId,
      name,
      imageUrl: storedImageUrl,
      price: price
        ? {
            value: price.value, // Already in cents (integer)
            currency: price.currency.toLowerCase(),
          }
        : null,
      link,
      notes,
      // Owners set it. A proposal starts without it; the owner decides on review.
      mostWanted: isOwner ? (mostWanted ?? false) : false,
      status: status || 'available',
      // Always unbooked. A booking with no Reservation behind it is one nobody
      // can release (only the holder can unbook, and owners are booking-blind).
      bookedBy: null,
    };

    // Set proposedBy for proposed items
    if (status === 'proposed') {
      itemData.proposedBy = new mongoose.Types.ObjectId(session.user.id);
    }

    const item = await Item.create(itemData).catch(async (err) => {
      // Nothing holds the copy now, so free it rather than leak it.
      await deleteOwnBlob(copiedImageUrl);
      throw err;
    });

    // A visible new item changes the count on the list's share card.
    if (isCountedOnShareCard(item.status)) await purgeShareCards({ wishlistIds: [wishlistId] });

    // Tell every owner a new item was proposed — anonymously: owners must never
    // learn who proposed an item (they can't see proposedBy elsewhere either).
    // All co-owners get it; nobody depends on the creator being online.
    if (item.status === 'proposed') {
      await createNotifications(ownerIds(wishlist), {
        type: 'proposal',
        actorUsername: null,
        wishlist: wishlist._id,
        wishlistName: wishlist.name,
        wishlistSlug: wishlist.slug ?? null,
        itemName: item.name,
      });
    }

    // Carries the list read's `priceInUsdCents`, so the page can sort the new
    // item by price before the next poll brings it in. A copy's reply describes
    // only the copy: nothing in it depends on the source's status or bookings.
    return NextResponse.json(
      {
        success: true,
        data: { ...item.toObject(), priceInUsdCents: itemPriceInUsdCents(item.price, rates) },
        ...(notice ? { notice } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json({ success: false, error: 'Failed to create item' }, { status: 500 });
  }
}
