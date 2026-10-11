import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { updateItemSchema, validateRequestBody } from '@/lib/validations';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { EXPECTED_PROPOSAL, EXPECTED_STATUS_PARAM } from '@/lib/utils/proposalReview';
import { deleteItem, updateItem, type ItemActionFailure } from '@/lib/utils/itemActions';

// The route authenticates the caller, reads the item and its list, decides who
// the caller is on it, rate-limits and parses; the actions themselves (their
// conditional writes, side effects and `serializeItem`-shaped answers) live in
// `lib/utils/itemActions.ts` (WIS-373).

function failureResponse({ status, error, data }: ItemActionFailure) {
  return NextResponse.json(
    { success: false, error, ...(data !== undefined && { data }) },
    { status }
  );
}

// PATCH /api/items/[id] - Update an item
// Members can book/unbook items (only their own bookings)
// Wishlist owners can edit content and publish/draft/complete/reopen, never book
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    const currentUser = await User.findById(session.user.id);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 });
    }

    const { id } = await params;

    const currentItem = isObjectIdParam(id) ? await Item.findById(id) : null;
    if (!currentItem) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(currentItem.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // An archived list is owner-only, so nobody else may book, unbook or edit a
    // proposal on it. Answered like a missing item, so it doesn't reveal the list.
    if (isHiddenByArchive(wishlist, session.user.id)) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    // Check if user has access to this wishlist. Every co-owner is an owner, so
    // none of them can book, and none of them see booking state in the response.
    const isOwner = isWishlistOwner(wishlist, session.user.id);
    const isMember = !!(await WishlistMember.findOne({
      wishlist: wishlist._id,
      user: session.user.id,
    }));
    const isProposer = currentItem.proposedBy?.toString() === session.user.id;
    const hasAccess = isOwner || isMember || isProposer;

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No access to this wishlist' },
        { status: 403 }
      );
    }

    // Covers edits and book/unbook toggles — curb toggle churn + notification
    // noise. A new account's bookings are on the stricter tier (WIS-337: a Join
    // link forwarded beyond its audience, and owners who can't see bookings,
    // would let a fresh account reserve a whole list); an owner editing their
    // own items never is, so it's decided once ownership is known.
    const limited = await enforce('booking', userKey(session.user.id), {
      newAccount: !isOwner && session.user.newAccount,
    });
    if (limited) return limited;

    // Validate request body
    const validation = await validateRequestBody(request, updateItemSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const result = await updateItem({
      item: currentItem,
      wishlist,
      actor: { userId: session.user.id, isOwner, isMember, isProposer },
      data: validation.data,
    });
    if (!result.ok) return failureResponse(result);
    return NextResponse.json(
      { success: true, data: result.data, ...(result.notice && { notice: result.notice }) },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json({ success: false, error: 'Failed to update item' }, { status: 500 });
  }
}

// DELETE /api/items/[id] - Delete an item
// Owners can delete any item
// Proposers can delete their own proposed items
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
    const { id } = await params;

    const item = isObjectIdParam(id) ? await Item.findById(id) : null;
    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const wishlist = await Wishlist.findById(item.wishlist);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Owner-only once archived: a proposer can't withdraw on it either (see PATCH).
    if (isHiddenByArchive(wishlist, session.user.id)) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const isOwner = isWishlistOwner(wishlist, session.user.id);
    const isProposer =
      item.status === 'proposed' && item.proposedBy?.toString() === session.user.id;
    // Only an owner, or the proposer of a still-pending proposal, may delete.
    if (!isOwner && !isProposer) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner or proposer access required' },
        { status: 403 }
      );
    }

    // The review dialog's Decline says it expects a proposal (WIS-199).
    const expected = request.nextUrl.searchParams.get(EXPECTED_STATUS_PARAM);
    if (expected !== null && expected !== EXPECTED_PROPOSAL) {
      return NextResponse.json(
        { success: false, error: `${EXPECTED_STATUS_PARAM} must be ${EXPECTED_PROPOSAL}` },
        { status: 400 }
      );
    }
    const expectsProposal = expected === EXPECTED_PROPOSAL;

    const result = await deleteItem({
      item,
      wishlist,
      isOwner,
      userId: session.user.id,
      expectsProposal,
    });
    if (!result.ok) return failureResponse(result);
    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 });
  }
}
