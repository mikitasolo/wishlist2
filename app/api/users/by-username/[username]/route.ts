import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, ipKey } from '@/lib/rateLimit';
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
    // Public profile lookup — key on IP to blunt scraping.
    const limited = await enforce('search', ipKey(request.headers));
    if (limited) return limited;

    const { username } = await params;
    await connectDB();

    const user = await User.findOne({ username: username.toLowerCase().trim() }).select(
      'username image bio privacy'
    );
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const session = await auth();

    const [followerCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
    ]);

    let follow = { isFollowing: false, followsYou: false, isFriend: false };
    const isSelf = session?.user?.id === user._id.toString();
    if (session?.user && !isSelf) {
      follow = await getFollowInfo(session.user.id, user._id.toString());
    }

    // Bio is part of what "friends only" hides — keep username/avatar public so
    // people can still find and follow, but withhold the bio from non-friends.
    const canSeeBio = isSelf || follow.isFriend || user.privacy?.profileVisibility !== 'friends';

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: user._id,
          username: user.username,
          image: user.image ?? null,
          bio: canSeeBio ? (user.bio ?? null) : null,
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
