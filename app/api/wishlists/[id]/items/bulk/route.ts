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
  claimItemBatch,
  finishItemBatch,
  releaseItemBatch,
} from '@/lib/utils/bulkItemActions';
import { errorKind } from '@/lib/utils/errorKind';

// Up to 100 items, each its own single-item change.
export const maxDuration = 30;

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
    const { action, itemIds } = validation.data;

    const claim = await claimItemBatch({
      userId,
      scopedKey: scopedIdempotencyKey(userId, key),
      wishlistId: id,
      action,
      itemIds,
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

    // One token for the batch, from the bucket an owner's single-item edit
    // spends (an owner is never on the new-account tier there). A refused
    // batch lets go of its key, so the retry after the wait goes ahead.
    const limited = await enforce('booking', userKey(userId), { newAccount: false });
    if (limited) {
      await releaseItemBatch(claim.batchId);
      return limited;
    }

    let answer;
    try {
      answer = await applyBulkItemAction({ wishlist, userId, action, itemIds });
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
