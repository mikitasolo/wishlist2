import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { bulkItemActionSchema, validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import {
  IDEMPOTENCY_HEADER,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';
import {
  applyBulkItemAction,
  applyBulkMoveAction,
  claimItemBatch,
  finishItemBatch,
  releaseItemBatch,
} from '@/lib/utils/bulkItemActions';
import { errorKind } from '@/lib/utils/errorKind';
import { isMoveTarget } from '@/lib/utils/bulkItemMove';
import { MOVE_TARGET_ERROR } from '@/lib/utils/bulkItems';

// Up to 100 items, each its own single-item change (a few at a time); lined up
// with `ITEM_BATCH_STALE_MS` and `BULK_REQUEST_TIMEOUT_MS`.
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/wishlists/[id]/items/bulk - An owner's action on several items at
 * once (WIS-386): `{ action, itemIds }` with an `Idempotency-Key`, answered
 * with `{ done, skipped, gone, failed, items }` (`BulkItemResult`). One
 * request per batch, each item held to the rules its own `PATCH` / `DELETE`
 * is (`lib/utils/bulkItemActions.ts`).
 *
 * Owners only, archived lists included (they're their owners' to see).
 * Everyone else gets what every owner-only list route answers: the missing
 * list's 404 on an archived list (and on one that doesn't exist), else 403;
 * signed out, 401 before any lookup. A retry with the same key is answered as
 * the first attempt was, before any limit is spent.
 *
 * A `move` (WIS-434) also takes `targetWishlistId`: another list the caller
 * owns that isn't archived, checked once the key is claimed and again once
 * the copies are written (`lib/utils/bulkItemMove.ts`). Any other target is
 * the one 422 (`MOVE_TARGET_ERROR`), whatever's wrong with it.
 */
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

    const id = await resolveWishlistId((await params).id);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    await connectDB();
    const { isOwner, wishlist } = await getOwnerAccess(id, userId);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    const key = readIdempotencyKey(request.headers);
    if (!key) {
      return NextResponse.json(
        { success: false, error: `Missing or invalid ${IDEMPOTENCY_HEADER} header` },
        { status: 400 }
      );
    }

    const validation = await validateRequestBody(request, bulkItemActionSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { action, itemIds, targetWishlistId } = validation.data;

    const claim = await claimItemBatch({
      userId,
      scopedKey: scopedIdempotencyKey(userId, key),
      wishlistId: id,
      action,
      itemIds,
      targetId: targetWishlistId,
    });
    if (claim.kind === 'replay') {
      return NextResponse.json(
        { success: true, data: claim.answer },
        { status: 200, headers: NO_STORE }
      );
    }
    if (claim.kind === 'refused') {
      return NextResponse.json(
        { success: false, error: claim.error },
        { status: claim.status, headers: NO_STORE }
      );
    }

    // The batch's own budget (`bulkItems`): an owner is on no new-account
    // tier for their own items. A refused batch lets go of its key, so the
    // retry after the wait goes ahead.
    const moveRefused = () =>
      NextResponse.json(
        { success: false, error: MOVE_TARGET_ERROR },
        { status: 422, headers: NO_STORE }
      );
    // A move's target: the caller's own, not archived, not this list. One
    // answer for all else, so a list that isn't theirs is never confirmed.
    if (action === 'move') {
      const target = targetWishlistId
        ? await getOwnerAccess(targetWishlistId, userId)
        : { isOwner: false };
      if (!isMoveTarget(target, id)) {
        await releaseItemBatch(claim.batchId);
        return moveRefused();
      }
    }

    const limited = await enforce('bulkItems', userKey(userId));
    if (limited) {
      await releaseItemBatch(claim.batchId);
      return limited;
    }

    let answer;
    try {
      if (action === 'move') {
        const moved = await applyBulkMoveAction({
          wishlist,
          userId,
          itemIds,
          targetId: targetWishlistId!,
          batchId: claim.batchId,
        });
        if ('refused' in moved) {
          // The re-check after the copies were written: they're taken back,
          // nothing was moved, and the answer is the one given up front.
          await releaseItemBatch(claim.batchId);
          if (moved.refused === 'target') return moveRefused();
          return moved.refused === 'source gone'
            ? NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 })
            : NextResponse.json(
                { success: false, error: 'Unauthorized - Owner access required' },
                { status: 403 }
              );
        }
        answer = moved;
      } else {
        answer = await applyBulkItemAction({ wishlist, userId, action, itemIds });
      }
    } catch (err) {
      await releaseItemBatch(claim.batchId);
      throw err;
    }
    await finishItemBatch(claim.batchId, answer);
    return NextResponse.json({ success: true, data: answer }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error(`Error applying a bulk item action (${errorKind(error)})`);
    return NextResponse.json({ success: false, error: 'Failed to update items' }, { status: 500 });
  }
}
