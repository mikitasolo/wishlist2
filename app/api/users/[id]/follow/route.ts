import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Follow from '@/models/Follow';

// POST /api/users/[id]/follow - follow a user
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id: targetId } = await params;
    if (targetId === session.user.id) {
      return NextResponse.json({ success: false, error: 'You can’t follow yourself' }, { status: 400 });
    }

    await connectDB();
    const target = await User.findById(targetId).select('_id');
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Idempotent: unique index prevents duplicates
    await Follow.updateOne(
      { follower: session.user.id, following: targetId },
      { $setOnInsert: { follower: session.user.id, following: targetId } },
      { upsert: true }
    );

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
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id: targetId } = await params;

    await connectDB();
    await Follow.deleteOne({ follower: session.user.id, following: targetId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    return NextResponse.json({ success: false, error: 'Failed to unfollow' }, { status: 500 });
  }
}
