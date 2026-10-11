import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistCopy from '@/models/WishlistCopy';
import { copyWishlistSchema, validateRequestBody } from '@/lib/validations';
import { generateUniqueWishlistSlug, resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { ownedByFilter, serializeWishlist } from '@/lib/utils/wishlistOwners';
import { copyBlobsToUploads, isOwnBlob } from '@/lib/utils/blob';
import {
  IDEMPOTENCY_HEADER,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';
import {
  COPY_IMAGES_BUDGET_MS,
  COPY_IN_PROGRESS_ERROR,
  COPYABLE_STATUSES,
  COPY_LIST_IMAGES_FAILED_NOTICE,
  COPY_LIST_IMAGES_QUOTA_NOTICE,
  copiedItemFields,
  serializeCopyCandidate,
  startingCopyOccasion,
} from '@/lib/utils/wishlistCopy';
import {
  finishCopy,
  isStaleCopy,
  settleCopy,
  settleStaleCopies,
  takeBackCopy,
} from '@/lib/utils/wishlistCopies';
import { errorKind } from '@/lib/utils/errorKind';
import { notifyAskersOfNewList } from '@/lib/utils/wishlistAsks';
import { remapLinks } from '@/lib/utils/itemLinks';

// Copying many images runs past the default limit. Lined up with
// `COPY_IMAGES_BUDGET_MS`, `COPY_STALE_MS` and the dialog's timeout
// (lib/utils/wishlistCopy.ts); Next.js needs it as a literal here.
export const maxDuration = 40;

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
    console.error('Error reading a list to copy:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to load wishlist' }, { status: 500 });
  }
}

/**
 * What an earlier attempt of this request (same key, same caller) left: its
 * finished list, answered again instead of making a second one (200); a 409
 * while that attempt is still making it; or null when there's nothing to
 * answer with, and this attempt goes ahead. An attempt that must have died is
 * settled first: finished if its list was written, else taken back whole. A
 * finished copy whose list has since been deleted is forgotten, and the
 * request makes it again.
 */
async function replayCopy(scopedKey: string, userId: string): Promise<NextResponse | null> {
  let row = await WishlistCopy.findOne({ key: scopedKey, user: userId }).lean();
  if (!row) return null;
  if (!row.done) {
    if (!isStaleCopy(row)) {
      return NextResponse.json(
        { success: false, error: COPY_IN_PROGRESS_ERROR },
        { status: 409, headers: NO_STORE }
      );
    }
    if ((await settleCopy(row._id, userId)) === 'taken back') return null;
    row = { ...row, done: true };
  }
  const list = await Wishlist.findOne({ _id: row.wishlist, ...ownedByFilter(userId) });
  if (list) {
    return NextResponse.json(
      { success: true, data: serializeWishlist(list, userId) },
      { status: 200, headers: NO_STORE }
    );
  }
  await WishlistCopy.deleteOne({ _id: row._id, done: true });
  return null;
}

/** Whether `err` is the unique index refusing a second row for one request's key. */
function isCopyKeyClash(err: unknown): boolean {
  const { code, keyPattern } = (err ?? {}) as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
  };
  return code === 11000 && !!keyPattern && 'key' in keyPattern;
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
    // A retry is answered before any limit is spent: only a new copy spends.
    const replayed = await replayCopy(scopedKey, userId);
    if (replayed) return replayed;

    // Making a list, as POST /api/wishlists does, with its budget, plus one of
    // its own, since one request copies up to 100 items and their images. Only
    // once the caller is known to own the list: a 429 only an existing list
    // could answer with would give away an archived one.
    const tier = { newAccount: session.user.newAccount };
    const limited =
      (await enforce('listCopy', userKey(userId), tier)) ??
      (await enforce('content', userKey(userId), tier));
    if (limited) return limited;

    // Any earlier copy of theirs that died (its key since dropped by the
    // dialog) is settled now, so it doesn't keep its items and images.
    try {
      await settleStaleCopies(userId);
    } catch (err) {
      console.error('Settling stale list copies failed:', errorKind(err));
    }

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

    // The request is recorded first, under its key: a retry racing this
    // attempt is refused by the unique index before it copies anything, and is
    // told to wait. The list itself is written last, so until it's finished
    // there's no list for anything to read, count, share or invite to.
    const newId = new mongoose.Types.ObjectId();
    let copyRow;
    try {
      copyRow = await WishlistCopy.create({ user: userId, key: scopedKey, wishlist: newId });
    } catch (err) {
      if (isCopyKeyClash(err)) {
        const again = await replayCopy(scopedKey, userId);
        if (again) return again;
      }
      throw err;
    }

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
      const copies = await copyBlobsToUploads(
        toCopy.map((c) => c.url),
        userId,
        COPY_IMAGES_BUDGET_MS,
        async (url) => {
          await WishlistCopy.updateOne({ _id: copyRow._id }, { $push: { copiedUrls: url } });
        }
      );
      toCopy.forEach(({ i }, k) => {
        const copied = copies[k];
        if (copied.ok) images[i] = copied.url;
        else if (copied.reason === 'quota') notice = COPY_LIST_IMAGES_QUOTA_NOTICE;
        else notice ??= COPY_LIST_IMAGES_FAILED_NOTICE;
      });
      const [bannerUrl, ...itemImages] = images;

      // Spread over the milliseconds before now, in the source's order, so the
      // new list shows them in the order the source does. Nothing reads them
      // until their list exists.
      const base = Date.now() - items.length;
      // Links between items both copied go with them, onto the copies; one to
      // an item left out is dropped (WIS-29). The copies' ids are picked here
      // so each can name its partners' in the same write.
      const copyIds = new Map(
        items.map((item) => [item._id.toString(), new mongoose.Types.ObjectId()])
      );
      const links = remapLinks(items, copyIds);
      await Item.insertMany(
        items.map((item, i) => ({
          _id: copyIds.get(item._id.toString()),
          wishlist: newId,
          ...copiedItemFields(item, { withTags: true }),
          imageUrl: itemImages[i] ?? undefined,
          relatedItems: links.get(item._id.toString()) ?? [],
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
        await takeBackCopy(copyRow._id, userId);
        return after.wishlist ? NOT_OWNER() : NOT_FOUND();
      }

      made = await Wishlist.create({
        _id: newId,
        name,
        slug: await generateUniqueWishlistSlug(name),
        description: source.description || undefined,
        // Only the person who starts the copy owns it: the source's other
        // owners are offered an owner invite afterwards, which they must accept.
        owners: [userId],
        visibility,
        bannerUrl,
        ...(occasion ? { occasion } : {}),
        currency: source.currency || 'USD',
      });
    } catch (err) {
      // No half a list: whatever items and images made it are taken back. A
      // failure there is logged, never put in place of the one that got here.
      try {
        await takeBackCopy(copyRow._id, userId);
      } catch (undoErr) {
        console.error('Taking back a failed list copy failed:', errorKind(undoErr));
      }
      throw err;
    }

    // The list stands. If marking its row fails, the next retry or sweep sees
    // the list and marks it then.
    try {
      await finishCopy(copyRow._id);
    } catch (err) {
      console.error('Marking a list copy finished failed:', errorKind(err));
    }

    // WIS-324: friends who asked for a list, and can open this one, are told.
    await notifyAskersOfNewList(made, userId, session.user.username ?? null);

    return NextResponse.json(
      {
        success: true,
        data: serializeWishlist(made, userId),
        ...(notice ? { notice } : {}),
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (error) {
    console.error('Error copying a wishlist:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to create wishlist' },
      { status: 500 }
    );
  }
}
