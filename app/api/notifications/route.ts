import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Notification from '@/models/Notification';

const FEED_LIMIT = 30;

// GET /api/notifications - the current user's latest notifications + unread count.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const [rows, unreadCount] = await Promise.all([
      Notification.find({ user: session.user.id }).sort({ createdAt: -1 }).limit(FEED_LIMIT).lean(),
      Notification.countDocuments({ user: session.user.id, read: false }),
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
export async function PATCH() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();
    await Notification.updateMany({ user: session.user.id, read: false }, { $set: { read: true } });
    return NextResponse.json({ success: true, unreadCount: 0 }, { status: 200 });
  } catch (error) {
    console.error('Error marking notifications read:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update notifications' },
      { status: 500 }
    );
  }
}
