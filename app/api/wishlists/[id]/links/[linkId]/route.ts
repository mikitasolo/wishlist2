import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import ShareLink from '@/models/ShareLink';
import { updateShareLinkSchema, validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { errorKind } from '@/lib/utils/errorKind';
import { serializeShareLink } from '@/lib/utils/shareLinks';
import { purgeShareCards } from '@/lib/og/purge';
import { occasionExpiry } from '@/lib/utils/shareLinkExpiry';

// One of a list's share links (WIS-334): any owner edits or revokes any of
// them (links are the list's, not their maker's), the list archived or not.
// Anyone else is told what a missing list tells them.

type Params = { params: Promise<{ id: string; linkId: string }> };

const unauthorized = () =>
  NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
const notFound = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
// Only ever sent to an owner.
// Day after the occasion on a list with none ahead (a co-owner cleared it meanwhile).
const noOccasionError = () =>
  NextResponse.json(
    { success: false, error: 'This list has no occasion for the link to end with' },
    { status: 409 }
  );
const linkNotFound = () =>
  NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 });

/** The list `idParam` names, if `userId` owns it; otherwise null (answer `notFound`). */
async function ownedListId(idParam: string, userId: string): Promise<string | null> {
  const id = await resolveWishlistId(idParam);
  if (!id) return null;
  await connectDB();
  const { isOwner, wishlist } = await getOwnerAccess(id, userId);
  return wishlist && isOwner ? id : null;
}

// PATCH /api/wishlists/[id]/links/[linkId] - change a link's label or expiry.
// Never its level (the schema refuses one): make a new link instead.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: idParam, linkId } = await params;
    const id = await ownedListId(idParam, session.user.id);
    if (!id) return notFound();
    if (!isObjectIdParam(linkId)) return linkNotFound();

    const validation = await validateRequestBody(request, updateShareLinkSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { label } = validation.data;
    let { expiresAt } = validation.data;
    // A date set any other way than Day after the occasion stops it following
    // the occasion (WIS-342).
    const untilOccasion =
      validation.data.untilOccasion ?? (expiresAt !== undefined ? false : undefined);
    const timeZone =
      untilOccasion === undefined ? undefined : untilOccasion ? validation.data.timeZone! : null;

    // Ownership again right before the write: the body was read in between,
    // and a co-owner may have taken the caller off the list meanwhile.
    const current = await getOwnerAccess(id, session.user.id);
    if (!current.wishlist || !current.isOwner) return notFound();
    if (untilOccasion) {
      // The server works out the date, from the occasion as it is now.
      const ends = occasionExpiry(current.wishlist.occasion, timeZone!);
      if (!ends) return noOccasionError();
      expiresAt = ends;
    }

    const link = await ShareLink.findOneAndUpdate(
      { _id: linkId, wishlist: id },
      {
        $set: {
          ...(label !== undefined ? { label } : {}),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          ...(untilOccasion !== undefined ? { untilOccasion, timeZone } : {}),
        },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!link) return linkNotFound();
    // The link's preview card is cached no longer than its expiry as it was
    // (lib/og/shareCards.ts): a new expiry, earlier or later, drops it. The
    // label isn't on the card.
    if (expiresAt !== undefined) await purgeShareCards({ shareLinkIds: [linkId] });

    // No token: only the link list and the create answer carry one.
    return NextResponse.json(
      { success: true, data: serializeShareLink(link, { withToken: false }) },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('Error updating share link:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to update link' }, { status: 500 });
  }
}

// DELETE /api/wishlists/[id]/links/[linkId] - revoke a link. It stops working
// at once: nothing about who opened it is kept, so nothing else goes with it.
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: idParam, linkId } = await params;
    const id = await ownedListId(idParam, session.user.id);
    if (!id) return notFound();
    if (!isObjectIdParam(linkId)) return linkNotFound();

    const { deletedCount } = await ShareLink.deleteOne({ _id: linkId, wishlist: id });
    if (!deletedCount) return linkNotFound();
    // A chat that fetched the link's preview keeps its copy; our CDN doesn't.
    await purgeShareCards({ shareLinkIds: [linkId] });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error revoking share link:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to revoke link' }, { status: 500 });
  }
}
