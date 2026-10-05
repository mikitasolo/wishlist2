import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import type { FilterQuery } from 'mongoose';
import Notification, { type INotification } from '@/models/Notification';
import User from '@/models/User';
import Follow from '@/models/Follow';
import { pausedInviteWishlistIds } from '@/lib/utils/wishlistInvites';
import { showsActor } from '@/lib/utils/notifications';

const FEED_LIMIT = 30;

/**
 * The current user's notifications, less the ones about a paused invite: an
 * unanswered `wishlist_invite` for a list that is archived while their member
 * invite to it waits (see `isInvitePaused`). It's left in place, unread, and
 * comes back once the list is unarchived. Answered ones ("You joined …") stay.
 */
async function visibleNotifications(userId: string): Promise<FilterQuery<INotification>> {
  const paused = await pausedInviteWishlistIds(userId);
  if (paused.length === 0) return { user: userId };
  return {
    user: userId,
    $nor: [{ type: 'wishlist_invite', wishlist: { $in: paused }, inviteAnswer: null }],
  };
}

type FeedRow = Pick<INotification, 'type' | 'actor' | 'count'>;

interface Actor {
  id: string;
  image: string | null;
}

/** The account a row shows as its actor, if it may show one and recorded who. */
const actorOf = (n: FeedRow) => (showsActor(n.type) && n.actor ? n.actor.toString() : null);

/**
 * The people the feed's rows show, as they are now: for their avatar, and for
 * Follow back. Looked up by the account each row recorded (`actor`), never by
 * the username it reads with, which can change hands: a row from before rows
 * recorded one shows no face. Only the types that show an actor are looked up
 * (`showsActor`), so a proposal, a demotion or a removal never comes back with
 * a face, whatever its row holds. Also which of the one-person follows the
 * recipient already follows back.
 */
async function feedActors(userId: string, rows: FeedRow[]) {
  const ids = Array.from(new Set(rows.map(actorOf).filter((id): id is string => !!id)));
  const actors = new Map<string, Actor>();
  const followed = new Set<string>();
  if (ids.length === 0) return { actors, followed };

  const followers = Array.from(
    new Set(
      rows
        .filter((n) => n.type === 'follow' && (n.count ?? 1) === 1)
        .map(actorOf)
        .filter((id): id is string => !!id)
    )
  );
  const [users, edges] = await Promise.all([
    User.find({ _id: { $in: ids } })
      .select('image')
      .lean(),
    followers.length > 0
      ? Follow.find({ follower: userId, following: { $in: followers } })
          .select('following')
          .lean()
      : [],
  ]);
  for (const u of users) {
    actors.set(u._id.toString(), { id: u._id.toString(), image: u.image ?? null });
  }
  for (const e of edges) followed.add(e.following.toString());
  return { actors, followed };
}

// GET /api/notifications - the current user's latest notifications + unread count.
// `?actors=1` (Activity) also says who each row's actor is now (`feedActors`);
// Activity's unread badge (`useUnreadNotifications`), which reads this on every
// page and focus for its count, leaves it off and skips those reads.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const visible = await visibleNotifications(session.user.id);
    const [rows, unreadCount] = await Promise.all([
      Notification.find(visible).sort({ createdAt: -1 }).limit(FEED_LIMIT).lean(),
      Notification.countDocuments({ ...visible, read: false }),
    ]);

    const withActors = request.nextUrl.searchParams.get('actors') === '1';
    const { actors, followed } = withActors
      ? await feedActors(session.user.id, rows)
      : { actors: new Map<string, Actor>(), followed: new Set<string>() };

    const data = rows.map((n) => {
      const actorId = actorOf(n);
      const actor = actorId ? (actors.get(actorId) ?? null) : null;
      const oneFollower = n.type === 'follow' && (n.count ?? 1) === 1;
      return {
        _id: n._id.toString(),
        type: n.type,
        actorUsername: n.actorUsername ?? null,
        // Rows from before coalescing carry neither field: each is one event.
        count: n.count ?? 1,
        actorUsernames: n.actorUsernames ?? [],
        wishlistName: n.wishlistName ?? null,
        wishlistSlug: n.wishlistSlug ?? null,
        wishlistId: n.wishlist ? n.wishlist.toString() : null,
        itemName: n.itemName ?? null,
        inviteAnswer: n.inviteAnswer ?? null,
        inviteRole: n.type === 'wishlist_invite' ? (n.inviteRole ?? null) : null,
        actorId: actor?.id ?? null,
        actorImage: actor?.image ?? null,
        followingActor: oneFollower && actor ? followed.has(actor.id) : null,
        occasionKind: n.type === 'occasion_reminder' ? (n.occasionKind ?? null) : null,
        occasionDate: n.type === 'occasion_reminder' ? (n.occasionDate ?? null) : null,
        linkLabel: n.type === 'link_join' ? (n.linkLabel ?? null) : null,
        read: n.read,
        createdAt: n.createdAt,
      };
    });

    return NextResponse.json({ success: true, data, unreadCount }, { status: 200 });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

// PATCH /api/notifications - mark all of the current user's notifications read.
// Only the ones they can see: a paused invite's comes back unread.
export async function PATCH() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();
    const visible = await visibleNotifications(session.user.id);
    await Notification.updateMany({ ...visible, read: false }, { $set: { read: true } });
    return NextResponse.json({ success: true, unreadCount: 0 }, { status: 200 });
  } catch (error) {
    console.error('Error marking notifications read:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update notifications' },
      { status: 500 }
    );
  }
}
