import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import User from '@/models/User';
import { createNotifications } from '@/lib/notifications';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { ownerIds } from '@/lib/utils/wishlistOwners';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { clearJoinRequestNotifications, declineCutoff } from '@/lib/utils/joinRequests';
import type { JoinRequestView } from '@/components/WishlistPeopleTab';
import { readListForRequester, wishlistNotFound } from '@/lib/utils/joinRequestAccess';

const signInError = () =>
  NextResponse.json({ success: false, error: 'Unauthorized - Please sign in' }, { status: 401 });

const requested = (status: 200 | 201) =>
  NextResponse.json({ success: true, data: { requested: true } }, { status });

// GET /api/wishlists/[id]/requests - the list's pending requests to join (owners only)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    // Before the list is looked up, as every owner-only route does.
    if (!session?.user) return signInError();

    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) return wishlistNotFound();

    await connectDB();
    // An archived list is no list at all to anyone but its owners.
    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) return wishlistNotFound();
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    const rows = await WishlistJoinRequest.find({ wishlist: id, status: 'pending' })
      .sort({ createdAt: 1 })
      .lean();
    if (rows.length === 0) return NextResponse.json({ success: true, data: [] });

    // Someone already on the list has nothing left to ask: a request that
    // outlived their joining (its cleanup is best-effort) isn't listed.
    const owners = new Set(ownerIds(wishlist));
    const userIds = rows.map((r) => r.user);
    const [users, memberships] = await Promise.all([
      // Public fields only: an owner never sees a requester's email.
      User.find({ _id: { $in: userIds } })
        .select('username image')
        .lean(),
      WishlistMember.find({ wishlist: id, user: { $in: userIds } })
        .select('user')
        .lean(),
    ]);
    const members = new Set(memberships.map((m) => m.user.toString()));
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    const data: JoinRequestView[] = rows.flatMap((row) => {
      const userId = row.user.toString();
      const user = userById.get(userId);
      if (!user || owners.has(userId) || members.has(userId)) return [];
      return [
        {
          _id: row._id.toString(),
          user: { _id: userId, username: user.username ?? null, image: user.image ?? null },
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching join requests:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch requests' },
      { status: 500 }
    );
  }
}

// POST /api/wishlists/[id]/requests - ask the list's owners to invite you
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return signInError();
    const userId = session.user.id;

    const { id: idParam } = await params;
    await connectDB();
    // A list the caller can't open answers as one that doesn't exist.
    const access = await readListForRequester(idParam, userId);
    if (access.response) return access.response;
    const { wishlist, id } = access;

    if (access.isOwner || access.isMember) {
      return NextResponse.json(
        { success: false, error: 'You’re already on this list' },
        { status: 409 }
      );
    }

    // Each ask notifies every owner. Only once the caller is known to be able
    // to ask, so a 429 can't stand in for an answer about the list.
    const limited = await enforce('joinRequest', userKey(userId));
    if (limited) return limited;

    // An invite already waiting for them is the answer they asked for.
    if (await WishlistInvite.exists({ wishlist: id, invitedUser: userId, status: 'pending' })) {
      return NextResponse.json(
        { success: false, error: 'You already have an invite to this list. See Activity.' },
        { status: 409 }
      );
    }

    // A decline is silent, so for `ASK_AGAIN_AFTER_MS` the requester's page
    // keeps reading "Requested": asking again then (after cancelling it) only
    // puts that back, and tells the owners nothing.
    const declined = await WishlistJoinRequest.findOneAndUpdate(
      { wishlist: id, user: userId, status: 'declined', declinedAt: { $gt: declineCutoff() } },
      { $set: { withdrawn: false } }
    );
    if (declined) return requested(201);

    try {
      await WishlistJoinRequest.create({ wishlist: id, user: userId, status: 'pending' });
    } catch (err) {
      // One pending request per person per list: a concurrent ask (or a double
      // click) already made it, and notified the owners.
      if (isDuplicateKeyError(err)) return requested(200);
      throw err;
    }

    // A list deleted since it was read takes its requests with it, but only
    // those that existed by then: take back one written after that cleanup.
    if (!(await Wishlist.exists({ _id: id }))) {
      await WishlistJoinRequest.deleteMany({ wishlist: id, user: userId });
      return wishlistNotFound();
    }

    // Every owner, by the requester's public handle: never an email address.
    // Their emails wait for the request to be still pending once the rows are
    // written, as an email can't be taken back like the rows below.
    const stillPending = async () =>
      !!(await WishlistJoinRequest.exists({ wishlist: id, user: userId, status: 'pending' }));
    await createNotifications(
      ownerIds(wishlist),
      {
        type: 'join_request',
        actorUsername: session.user.username ?? null,
        actor: userId,
        wishlist: id,
        wishlistName: wishlist.name,
        wishlistSlug: wishlist.slug ?? null,
      },
      { stillHolds: stillPending }
    );
    // Cancelled or answered while those were being written: that cleanup ran
    // before they existed, so take them back here.
    if (!(await stillPending())) await clearJoinRequestNotifications(id, userId);

    return requested(201);
  } catch (error) {
    console.error('Error requesting to join:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send your request' },
      { status: 500 }
    );
  }
}
