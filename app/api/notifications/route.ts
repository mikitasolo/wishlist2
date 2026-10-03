import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import type { FilterQuery } from 'mongoose';
import Notification, { type INotification } from '@/models/Notification';
import { pausedInviteWishlistIds } from '@/lib/utils/wishlistInvites';

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

    const data = rows.map((n) => ({
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
      read: n.read,
      createdAt: n.createdAt,
    }));

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
