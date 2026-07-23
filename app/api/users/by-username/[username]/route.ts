import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Follow from '@/models/Follow';
import { getFollowInfo } from '@/lib/utils/friends';

// GET /api/users/by-username/[username] - resolve a username to a public profile,
// including follow relationship + counts for the current viewer.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    await connectDB();

    const user = await User.findOne({ username: username.toLowerCase().trim() }).select(
      'username image bio'
    );
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const session = await getServerSession(authOptions);

    const [followerCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
    ]);

    let follow = { isFollowing: false, followsYou: false, isFriend: false };
    const isSelf = session?.user?.id === user._id.toString();
    if (session?.user && !isSelf) {
      follow = await getFollowInfo(session.user.id, user._id.toString());
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: user._id,
          username: user.username,
          image: user.image ?? null,
          bio: user.bio ?? null,
          isSelf,
          followerCount,
          followingCount,
          ...follow,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error resolving username:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch user' }, { status: 500 });
  }
}
