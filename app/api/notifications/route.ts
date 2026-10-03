import { NextResponse } from 'next/server';
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

type FeedRow = Pick<INotification, 'type' | 'actorUsername' | 'count'>;

interface Actor {
  id: string;
  image: string | null;
}

/**
 * The people the feed's rows name, as they are now, by username: for their
 * avatar, and for Follow back. Only the types that show an actor are looked up
 * (`showsActor`), so a proposal, a demotion or a removal never comes back with
 * a face, whatever its row holds. Also which of the one-person follows the
 * recipient already follows back.
 */
async function feedActors(userId: string, rows: FeedRow[]) {
  const usernames = Array.from(
    new Set(
      rows
        .filter((n) => showsActor(n.type) && n.actorUsername)
        .map((n) => n.actorUsername as string)
    )
  );
  const actors = new Map<string, Actor>();
  const followed = new Set<string>();
  if (usernames.length === 0) return { actors, followed };

  const users = await User.find({ username: { $in: usernames } })
    .select('username image')
    .lean();
  for (const u of users) {
    if (u.username) actors.set(u.username, { id: u._id.toString(), image: u.image ?? null });
  }

  const followers = rows
    .filter((n) => n.type === 'follow' && (n.count ?? 1) === 1 && n.actorUsername)
    .map((n) => actors.get(n.actorUsername as string)?.id)
    .filter((id): id is string => !!id);
  if (followers.length > 0) {
    const edges = await Follow.find({ follower: userId, following: { $in: followers } })
      .select('following')
      .lean();
    for (const e of edges) followed.add(e.following.toString());
  }
  return { actors, followed };
}

// GET /api/notifications - the current user's latest notifications + unread count.
export async function GET() {
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

    const { actors, followed } = await feedActors(session.user.id, rows);

    const data = rows.map((n) => {
      const actor =
        showsActor(n.type) && n.actorUsername ? (actors.get(n.actorUsername) ?? null) : null;
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
        actorId: actor?.id ?? null,
        actorImage: actor?.image ?? null,
        followingActor: oneFollower && actor ? followed.has(actor.id) : null,
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
