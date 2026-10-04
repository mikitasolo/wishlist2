import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Follow from '@/models/Follow';
import { createNotification } from '@/lib/notifications';
import { isObjectIdParam } from '@/lib/utils/objectId';

// POST /api/users/[id]/follow - follow a user
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Curb follow/unfollow churn and the notification spam it produces.
    const limited = await enforce('follow', userKey(session.user.id), {
      newAccount: session.user.newAccount,
    });
    if (limited) return limited;

    const { id: targetId } = await params;
    if (targetId === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'You can’t follow yourself' },
        { status: 400 }
      );
    }

    await connectDB();
    const target = isObjectIdParam(targetId) ? await User.findById(targetId).select('_id') : null;
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Idempotent: unique index prevents duplicates
    const result = await Follow.updateOne(
      { follower: session.user.id, following: targetId },
      { $setOnInsert: { follower: session.user.id, following: targetId } },
      { upsert: true }
    );

    // Only notify on a genuinely new follow, not on a repeat/idempotent call.
    // The helper folds a burst of follows into one row and drops a re-follow by
    // someone who already notified this user in the last 24h (unfollow deletes
    // the edge, so follow → unfollow → follow lands here again).
    if (result.upsertedCount > 0) {
      await createNotification({
        user: targetId,
        type: 'follow',
        actorUsername: session.user.username ?? null,
        actor: session.user.id,
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error following user:', error);
    return NextResponse.json({ success: false, error: 'Failed to follow' }, { status: 500 });
  }
}

// DELETE /api/users/[id]/follow - unfollow a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id: targetId } = await params;

    // A malformed id follows nobody, so there's nothing to unfollow: the same
    // answer as for anyone you don't follow.
    if (isObjectIdParam(targetId)) {
      await connectDB();
      await Follow.deleteOne({ follower: session.user.id, following: targetId });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    return NextResponse.json({ success: false, error: 'Failed to unfollow' }, { status: 500 });
  }
}
