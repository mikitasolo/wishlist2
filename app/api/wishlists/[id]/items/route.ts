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
import { hasRate, normalizeCurrency } from '@/lib/utils/currency';
import { readGivenByViewer, serializeItem, type ItemViewer } from '@/lib/utils/itemSerializer';
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
import { errorKind } from '@/lib/utils/errorKind';
import {
  canCopyItem,
  COPY_IMAGE_FAILED_NOTICE,
  COPY_IMAGE_QUOTA_NOTICE,
} from '@/lib/utils/itemCopy';
import { isCountedOnShareCard } from '@/lib/og/data';
import { purgeShareCards } from '@/lib/og/purge';
import {
  IDEMPOTENCY_HEADER,
  isIdempotencyKeyClash,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';

const wishlistGone = () =>
  NextResponse.json({ success: false, error: 'This wishlist no longer exists' }, { status: 404 });

/**
 * Whether the list is gone now, read once its new item is written (WIS-182).
 * Deleting a list removes the list before its items, so a create that read
 * the list before a delete and writes after the delete's item cleanup would
 * leave an item nothing can reach or free. Re-reading the list after the write
 * closes that, as `dropIfWishlistGone` does for notifications: a list that's
 * still there now can only be deleted later, and that delete's cleanup takes
 * the item. A failed read counts as the list being there (the item stays, as
 * it did before this check), so it never turns a saved item into an error.
 */
async function isWishlistGone(wishlistId: string): Promise<boolean> {
  try {
    return !(await Wishlist.exists({ _id: wishlistId }));
  } catch (err) {
    console.error('Failed to re-check the wishlist of a new item:', errorKind(err));
    return false;
  }
}

/**
 * Take back an item written onto a list deleted meanwhile, and free its image:
 * the one on the item this delete took, or, when the list delete's own cleanup
 * took the item first, the one this request wrote (`storedImageUrl`). That
 * cleanup frees only the images it read before its delete, so an item written
 * between the two would leak its image otherwise. Freeing one twice is
 * harmless; leaking it isn't (it counts against the uploader's quota). A
 * copy's blob (`copiedImageUrl`) was made for this item alone, so it's freed
 * whatever the item holds by now.
 */
async function undoCreate(
  itemId: mongoose.Types.ObjectId,
  storedImageUrl: string | undefined,
  copiedImageUrl: string | undefined
): Promise<void> {
  try {
    const deleted = await Item.findOneAndDelete({ _id: itemId });
    const held = deleted ? deleted.imageUrl : storedImageUrl;
    await deleteOwnBlob(held);
    if (copiedImageUrl && copiedImageUrl !== held) await deleteOwnBlob(copiedImageUrl);
  } catch (err) {
    console.error('Failed to take back an item on a deleted wishlist:', errorKind(err));
  }
}

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

/**
 * The answer to a create whose key (`scopedKey`, already scoped to the caller)
 * made an item on this list before: that item, shaped for the caller as the
 * first answer was, so a retry of a POST whose response was lost doesn't add a
 * second copy (WIS-158). Null when the key made nothing here (nor anything
 * since deleted), and the create goes ahead.
 *
 * The caller passed every check the first attempt did, again, before this. A
 * key only ever finds the caller's own item. One a member can no longer see
 * (an owner has since made it a draft, or it was made while they owned the
 * list) isn't returned: they get a 409 that says no more than that it's
 * already there, never its status.
 */
async function replayCreate(
  wishlistId: string,
  scopedKey: string,
  isOwner: boolean,
  userId: string,
  rates: Map<string, number>
): Promise<NextResponse | null> {
  const existing = await Item.findOne({ wishlist: wishlistId, idempotencyKey: scopedKey });
  if (!existing) return null;
  // The list was deleted after this request read it: the item found is one its
  // delete (or the attempt that made it, see `isWishlistGone`) is taking away,
  // so it's never answered with.
  if (await isWishlistGone(wishlistId)) return wishlistGone();
  if (!isOwner && existing.status === 'draft') {
    return NextResponse.json(
      { success: false, error: 'This item has already been added' },
      { status: 409 }
    );
  }
  const viewer: ItemViewer = isOwner
    ? { role: 'owner' }
    : { role: 'member', id: userId, givenByViewer: await readGivenByViewer(userId, [existing]) };
  return NextResponse.json({ success: true, data: serializeItem(existing, viewer, rates) });
}

// GET /api/wishlists/[id]/items - Get all items for a wishlist
// Each item is shaped for its viewer by serializeItem: owners and visitors never
// see a booking, and nobody sees anyone else's id.
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
    // anyone else's bookings. serializeItem then shapes each item for the viewer.
    const viewerId = session?.user?.id;
    const viewer: ItemViewer = isOwner
      ? { role: 'owner' }
      : viewerId && isMember
        ? {
            role: 'member',
            id: viewerId,
            givenByViewer: await readGivenByViewer(viewerId, visibleItems),
          }
        : { role: 'visitor' };

    const filteredItems = visibleItems.map((item) => serializeItem(item, viewer, rates));

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
// With an `Idempotency-Key` header, a retry answers with the item the first
// attempt made (see replayCreate).
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
    const limited = await enforce('content', userKey(session.user.id), {
      newAccount: session.user.newAccount,
    });
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

    const idempotencyKey = readIdempotencyKey(request.headers);
    if (idempotencyKey === undefined) {
      return NextResponse.json(
        { success: false, error: `Invalid ${IDEMPOTENCY_HEADER} header` },
        { status: 400 }
      );
    }
    const scopedKey = idempotencyKey && scopedIdempotencyKey(session.user.id, idempotencyKey);

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
      if (!hasRate(rates, price.currency)) {
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

    // A retry of a create that was saved answers with that item. Checked once
    // everything that could refuse the request has passed again, and before a
    // copy's image is copied, which a retry mustn't do twice.
    if (scopedKey) {
      const replayed = await replayCreate(wishlistId, scopedKey, isOwner, session.user.id, rates);
      if (replayed) return replayed;
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
      idempotencyKey?: string;
    }

    const itemData: ItemCreateData = {
      wishlist: wishlistId,
      name,
      imageUrl: storedImageUrl,
      price: price
        ? {
            value: price.value, // Already in cents (integer)
            currency: normalizeCurrency(price.currency),
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
      ...(scopedKey ? { idempotencyKey: scopedKey } : {}),
    };

    // Set proposedBy for proposed items
    if (status === 'proposed') {
      itemData.proposedBy = new mongoose.Types.ObjectId(session.user.id);
    }

    let item;
    try {
      item = await Item.create(itemData);
    } catch (err) {
      // Nothing holds the copy now, so free it rather than leak it.
      await deleteOwnBlob(copiedImageUrl);
      // Another attempt of this same request got there first (two retries
      // racing past replayCreate): answer with its item.
      if (scopedKey && isIdempotencyKeyClash(err)) {
        const replayed = await replayCreate(wishlistId, scopedKey, isOwner, session.user.id, rates);
        if (replayed) return replayed;
      }
      throw err;
    }

    // The list may have been deleted since it was read, its items already
    // cleaned up: take this one back rather than leave it behind (WIS-182).
    if (await isWishlistGone(wishlistId)) {
      await undoCreate(item._id, storedImageUrl, copiedImageUrl);
      return wishlistGone();
    }

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

    // Shaped as the list read shapes it (serializeItem), so the page can sort
    // the new item by price before the next poll brings it in, and a proposal's
    // answer carries only its proposer's own id, as their read of the list does.
    // A new item is never booked, so a member's `givenByMe` is false without a
    // read. A copy's reply describes only the copy: nothing in it depends on the
    // source's status or bookings.
    const viewer: ItemViewer = isOwner
      ? { role: 'owner' }
      : { role: 'member', id: session.user.id, givenByViewer: new Set() };
    return NextResponse.json(
      {
        success: true,
        data: serializeItem(item, viewer, rates),
        ...(notice ? { notice } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json({ success: false, error: 'Failed to create item' }, { status: 500 });
  }
}
