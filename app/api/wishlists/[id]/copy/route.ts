import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import { copyWishlistSchema, validateRequestBody } from '@/lib/validations';
import { generateUniqueWishlistSlug, resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { ownedByFilter, serializeWishlist } from '@/lib/utils/wishlistOwners';
import {
  copyBlobToUploads,
  deleteOwnBlobs,
  getUserUploadBytes,
  isOwnBlob,
  type UploadCopy,
} from '@/lib/utils/blob';
import { deleteOwnedWishlist } from '@/lib/utils/wishlistDeletion';
import { normalizeCurrency } from '@/lib/utils/currency';
import {
  IDEMPOTENCY_HEADER,
  isIdempotencyKeyClash,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';
import {
  COPY_IN_PROGRESS_ERROR,
  COPY_PENDING_STALE_MS,
  COPYABLE_STATUSES,
  COPY_LIST_IMAGES_FAILED_NOTICE,
  COPY_LIST_IMAGES_QUOTA_NOTICE,
  copiedStatus,
  serializeCopyCandidate,
  startingCopyOccasion,
} from '@/lib/utils/wishlistCopy';
import { errorKind } from '@/lib/utils/errorKind';

// Copying many images runs past the default limit.
export const maxDuration = 60;

/**
 * "Start a new list from this one" (WIS-325), owners only, archived lists
 * included (they're their owners' to see). Everyone else gets what every
 * owner-only list route answers: the missing list's 404 on an archived list
 * (and on any list, signed in, for one that doesn't exist), else 403; signed
 * out, 401 before any lookup.
 *
 * Owners are booking-blind, and nothing here reads a booking: the items offered
 * are the list's own minus those marked received and pending proposals, in the
 * order they were added, shaped alike whether reserved or not, and their copies
 * start unreserved.
 */

const NOT_FOUND = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
const NOT_OWNER = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized - Owner access required' },
    { status: 403 }
  );
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** The owner check every request here starts with, or the answer refusing it. */
async function authorize(
  idParam: string,
  userId: string
): Promise<{ id: string; wishlist: IWishlist } | { refused: NextResponse }> {
  const id = await resolveWishlistId(idParam);
  if (!id) return { refused: NOT_FOUND() };
  await connectDB();
  const { isOwner, wishlist } = await getOwnerAccess(id, userId);
  if (!wishlist) return { refused: NOT_FOUND() };
  if (!isOwner) return { refused: NOT_OWNER() };
  return { id, wishlist };
}

// GET /api/wishlists/[id]/copy - What a new list made from this one starts with
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }
    const access = await authorize((await params).id, session.user.id);
    if ('refused' in access) return access.refused;
    const { id, wishlist } = access;

    const items = await Item.find({ wishlist: id, status: { $in: COPYABLE_STATUSES } })
      .sort({ createdAt: -1, _id: -1 })
      .select('name imageUrl mostWanted status')
      .lean();

    return NextResponse.json(
      {
        success: true,
        data: {
          name: wishlist.name,
          visibility: wishlist.visibility,
          occasion: startingCopyOccasion(wishlist.occasion),
          archived: !!wishlist.archived,
          items: items.map(serializeCopyCandidate),
        },
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (error) {
    console.error(`Error reading a list to copy (${errorKind(error)})`);
    return NextResponse.json({ success: false, error: 'Failed to load wishlist' }, { status: 500 });
  }
}

/** How many images are copied at once. */
const IMAGE_COPY_CONCURRENCY = 4;
/** After this long, images not yet started aren't copied: the list is made without them. */
const IMAGE_COPY_BUDGET_MS = 25_000;

/**
 * Copy each of `urls` (all our own blobs) into the user's uploads, a few at a
 * time, as "Save to my list" does for one: never shared with the source, so
 * deleting either list's item can't break the other's image. They share one
 * quota budget, read once, so together they never go over it.
 */
async function copyImages(urls: string[], userId: string): Promise<UploadCopy[]> {
  if (urls.length === 0) return [];
  const results: UploadCopy[] = new Array(urls.length);
  const budget = { used: await getUserUploadBytes(userId) };
  const deadline = Date.now() + IMAGE_COPY_BUDGET_MS;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      results[i] =
        Date.now() < deadline
          ? await copyBlobToUploads(urls[i], userId, budget)
          : { ok: false, reason: 'failed' };
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_COPY_CONCURRENCY, urls.length) }, worker));
  return results;
}

/**
 * What an earlier attempt of this request (same key, same caller) left: its
 * finished list, answered again instead of making a second one; a 409 while
 * that attempt is still making it; or null when there's nothing (or only a
 * list a dead attempt left half made, which is taken back here), and this
 * attempt goes ahead.
 */
async function replayCopy(scopedKey: string, userId: string): Promise<NextResponse | null> {
  const existing = await Wishlist.findOne({
    idempotencyKey: scopedKey,
    ...ownedByFilter(userId),
  }).select('+copyPending');
  if (!existing) return null;
  if (existing.copyPending) {
    if (Date.now() - existing.createdAt.getTime() < COPY_PENDING_STALE_MS) {
      return NextResponse.json(
        { success: false, error: COPY_IN_PROGRESS_ERROR },
        { status: 409, headers: NO_STORE }
      );
    }
    await deleteOwnedWishlist(existing._id.toString(), userId);
    return null;
  }
  return NextResponse.json(
    { success: true, data: serializeWishlist(existing, userId) },
    { status: 200, headers: NO_STORE }
  );
}

/** Takes back a copy that can't stand: the new list, its items and every image copied for it. */
async function undoCopy(wishlistId: string, copiedUrls: string[]) {
  await Wishlist.deleteOne({ _id: wishlistId });
  await Item.deleteMany({ wishlist: wishlistId });
  await deleteOwnBlobs(copiedUrls);
}

// POST /api/wishlists/[id]/copy - Make a new list from this one
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }
    const userId = session.user.id;
    const access = await authorize((await params).id, userId);
    if ('refused' in access) return access.refused;
    const { id, wishlist: source } = access;

    // Making a list, as POST /api/wishlists does, with its budget, plus one of
    // its own, since one request copies up to 100 items and their images. Only
    // once the caller is known to own the list: a 429 only an existing list
    // could answer with would give away an archived one.
    const tier = { newAccount: session.user.newAccount };
    const limited =
      (await enforce('listCopy', userKey(userId), tier)) ??
      (await enforce('content', userKey(userId), tier));
    if (limited) return limited;

    const validation = await validateRequestBody(request, copyWishlistSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { name, visibility, occasion, itemIds } = validation.data;

    // Required here: a retried copy must never make a second list.
    const key = readIdempotencyKey(request.headers);
    if (!key) {
      return NextResponse.json(
        { success: false, error: `Missing or invalid ${IDEMPOTENCY_HEADER} header` },
        { status: 400 }
      );
    }
    const scopedKey = scopedIdempotencyKey(userId, key);
    const replayed = await replayCopy(scopedKey, userId);
    if (replayed) return replayed;

    // Only the source's own copyable items: an id from another list, or one
    // marked received or still a proposal (since it was picked, say), is left
    // out like a deleted one. A booked item is copyable, so leaving items out
    // says nothing about reservations.
    const items = itemIds.length
      ? await Item.find({
          _id: { $in: itemIds },
          wishlist: id,
          status: { $in: COPYABLE_STATUSES },
        })
          .sort({ createdAt: 1, _id: 1 })
          .lean()
      : [];

    // The key is claimed first, by the list itself, marked as being made: a
    // retry racing this attempt is refused by the unique index before it
    // copies anything, and is told to wait rather than handed a list that
    // isn't finished (or that this attempt may still take back).
    let created;
    try {
      created = await Wishlist.create({
        name,
        slug: await generateUniqueWishlistSlug(name),
        description: source.description || undefined,
        // Only the person who starts the copy owns it: the source's other
        // owners are offered an owner invite afterwards, which they must accept.
        owners: [userId],
        visibility,
        bannerUrl: null,
        ...(occasion ? { occasion } : {}),
        currency: source.currency || 'USD',
        idempotencyKey: scopedKey,
        copyPending: true,
      });
    } catch (err) {
      // Another attempt of this request got there first: answer as it stands.
      if (isIdempotencyKeyClash(err)) {
        const again = await replayCopy(scopedKey, userId);
        if (again) return again;
      }
      throw err;
    }
    const newId = created._id.toString();

    const copiedUrls: string[] = [];
    let notice: string | undefined;
    let made;
    try {
      // Every image of ours is copied into the caller's uploads (their own
      // included: an image is never shared between two items or lists). An
      // external URL is kept: we never delete those. A copy that can't be made
      // leaves that item (or the list) without its image, and the answer says
      // so. One copy per use (the cover, then each item), so no two share one
      // even where the source's did.
      const sources = [source.bannerUrl, ...items.map((i) => i.imageUrl)];
      const images: Array<string | null> = sources.map((url) =>
        url && !isOwnBlob(url) ? url : null
      );
      const toCopy = sources.flatMap((url, i) => (isOwnBlob(url) ? [{ url, i }] : []));
      const copies = await copyImages(
        toCopy.map((c) => c.url),
        userId
      );
      toCopy.forEach(({ i }, k) => {
        const copied = copies[k];
        if (copied.ok) {
          images[i] = copied.url;
          copiedUrls.push(copied.url);
        } else if (copied.reason === 'quota') notice = COPY_LIST_IMAGES_QUOTA_NOTICE;
        else notice ??= COPY_LIST_IMAGES_FAILED_NOTICE;
      });
      const [bannerUrl, ...itemImages] = images;

      // Spread over the milliseconds before now, in the source's order, so the
      // new list shows them in the order the source does.
      const base = Date.now() - items.length;
      await Item.insertMany(
        items.map((item, i) => ({
          wishlist: newId,
          name: item.name,
          imageUrl: itemImages[i] ?? undefined,
          price: item.price
            ? { value: item.price.value, currency: normalizeCurrency(item.price.currency) }
            : null,
          link: item.link || undefined,
          notes: item.notes || undefined,
          mostWanted: !!item.mostWanted,
          status: copiedStatus(item.status),
          // Never reserved, never anyone's proposal: a new item on a new list.
          bookedBy: null,
          createdAt: new Date(base + i),
          updatedAt: new Date(base + i),
        })),
        { ordered: true }
      );

      // The caller was an owner when the request started. Re-read it: one
      // taken off the owners (or whose list was deleted) meanwhile gets the
      // copy taken back and the answer anyone else gets.
      const after = await getOwnerAccess(id, userId);
      if (!after.wishlist || !after.isOwner) {
        await undoCopy(newId, copiedUrls);
        return after.wishlist ? NOT_OWNER() : NOT_FOUND();
      }

      // Finished: the cover goes on and the mark comes off, in one write.
      made = await Wishlist.findOneAndUpdate(
        { _id: newId, ...ownedByFilter(userId) },
        { $set: { bannerUrl }, $unset: { copyPending: 1 } },
        { new: true }
      );
    } catch (err) {
      // No half a list: the list goes with whatever items and images made it.
      await undoCopy(newId, copiedUrls);
      throw err;
    }
    if (!made) {
      // Deleted by its owner before it was finished: nothing holds the copies.
      await undoCopy(newId, copiedUrls);
      return NOT_FOUND();
    }

    return NextResponse.json(
      {
        success: true,
        data: serializeWishlist(made, userId),
        ...(notice ? { notice } : {}),
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (error) {
    console.error(`Error copying a wishlist (${errorKind(error)})`);
    return NextResponse.json(
      { success: false, error: 'Failed to create wishlist' },
      { status: 500 }
    );
  }
}
