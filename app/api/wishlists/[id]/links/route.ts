import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import ShareLink from '@/models/ShareLink';
import { createShareLinkSchema, validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { errorKind } from '@/lib/utils/errorKind';
import {
  countJoinedByLink,
  insertShareLink,
  serializeShareLink,
  SHARE_LINK_CAP,
} from '@/lib/utils/shareLinks';

// The owners' share links (WIS-334). Owner-only, and a refused caller is told
// what a missing list tells them: these are the list's secrets, and the list's
// existence is no business of anyone the link list isn't for.

const unauthorized = () =>
  NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
const notFound = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
// Only ever sent to an owner: anyone else gets the 404 first.
const archivedError = () =>
  NextResponse.json(
    { success: false, error: 'Unarchive this list to create links' },
    { status: 409 }
  );
const capError = () =>
  NextResponse.json(
    {
      success: false,
      error: `This list already has ${SHARE_LINK_CAP} links. Revoke one to make another.`,
    },
    { status: 409 }
  );

/** No answer that carries a token may be cached anywhere along the way. */
const PRIVATE = { 'Cache-Control': 'private, no-store' };

// GET /api/wishlists/[id]/links - the list's share links, newest first (owners).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    // Before the list is looked up, so a signed-out caller is told the same
    // whether or not it exists.
    if (!session?.user) return unauthorized();
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) return notFound();
    await connectDB();
    // An archived list's owners still see, edit and revoke its links.
    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist || !isOwner) return notFound();

    const links = await ShareLink.find({ wishlist: wishlist._id }).sort({ createdAt: -1 }).lean();
    const joined = await countJoinedByLink(
      id,
      links.map((l) => l._id)
    );
    const now = new Date();
    const data = links.map((link) =>
      serializeShareLink(link, {
        now,
        joinedCount: joined.get(link._id.toString()) ?? 0,
        withToken: true,
      })
    );
    return NextResponse.json({ success: true, data }, { status: 200, headers: PRIVATE });
  } catch (error) {
    // Never the raw error: one about a link can quote its token.
    console.error('Error listing share links:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to list links' }, { status: 500 });
  }
}

// POST /api/wishlists/[id]/links - make a share link (owners).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) return notFound();
    await connectDB();
    const access = await getOwnerAccess(id, session.user.id);
    if (!access.wishlist || !access.isOwner) return notFound();

    const validation = await validateRequestBody(request, createShareLinkSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { level, label = null, expiresAt = null } = validation.data;

    // The cap counts expired links too: they're still listed, and a later
    // expiry brings one back. Re-checked once the link is written (below).
    if ((await ShareLink.countDocuments({ wishlist: id })) >= SHARE_LINK_CAP) return capError();

    // Ownership was read at the start of the request. Re-read it right before
    // the write, as an invite does: a co-owner may have taken the caller off
    // the list (or deleted it) meanwhile. That narrows the race; the re-read
    // after the write closes it.
    const current = await getOwnerAccess(id, session.user.id);
    if (!current.wishlist || !current.isOwner) return notFound();
    // Checked last, against the fresh read, so a link that couldn't be made
    // anyway gets that answer instead.
    if (current.wishlist.archived) return archivedError();

    // Spent only by a request about to make a link (a refused one costs
    // nothing), and only once the caller is known to own the list: a 429 that
    // only an existing list could answer with would give away an archived one.
    const limited = await enforce('shareLink', userKey(session.user.id), {
      newAccount: session.user.newAccount,
    });
    if (limited) return limited;

    const link = await insertShareLink({
      wishlistId: id,
      level,
      label,
      expiresAt,
      createdBy: session.user.id,
    });

    // Re-read after the write (the WIS-182 pattern). A list deleted after the
    // read above has had its links deleted already, which this one missed; a
    // caller taken off the owners meanwhile can't keep a link they made after
    // losing the list. Either way the link is taken back, so nothing points at
    // a list that's gone or was shared by someone no longer its owner. A list
    // still there and still theirs can only change later, and that change's
    // own cleanup (the list delete) takes the link.
    const after = await getOwnerAccess(id, session.user.id);
    if (!after.wishlist || !after.isOwner) {
      await ShareLink.deleteOne({ _id: link._id });
      return notFound();
    }
    // Two creates at once can both pass the count above. Each counts again now
    // that its own link exists, and one that took the list past the cap takes
    // itself back (racing ones may both do so; neither is kept over the cap).
    if ((await ShareLink.countDocuments({ wishlist: id })) > SHARE_LINK_CAP) {
      await ShareLink.deleteOne({ _id: link._id });
      return capError();
    }

    return NextResponse.json(
      { success: true, data: serializeShareLink(link, { withToken: true }) },
      { status: 201, headers: PRIVATE }
    );
  } catch (error) {
    // Never the raw error: a duplicate-key error quotes the token.
    console.error('Error creating share link:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to create link' }, { status: 500 });
  }
}
