import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { getFriendIds } from '@/lib/utils/friends';
import { birthdayVisibleFilter, visibleBirthday } from '@/lib/utils/birthday';
import type { FriendBirthday } from '@/lib/utils/comingUp';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// GET /api/users/me/birthdays - the birthdays of the caller's friends (mutual
// follows) that each friend's setting lets a friend see (WIS-343), for the
// dashboard's Coming up. Only `{ id, username, image, birthday }`, the stored
// placeholder-year date: the browser works out which fall in its window, from
// its own local date. Nothing about anyone's lists, and no email. A friend
// with no username has no handle to name them by, so isn't in it.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: PRIVATE }
      );
    }
    await connectDB();

    const me = session.user.id;
    const friendIds = (await getFriendIds(me)).filter((id) => id !== me);
    let data: FriendBirthday[] = [];
    if (friendIds.length > 0) {
      const friends = await User.find({
        ...birthdayVisibleFilter('friend'),
        _id: { $in: friendIds.map((id) => new mongoose.Types.ObjectId(id)) },
        username: { $type: 'string', $ne: '' },
      })
        .select('username image birthday privacy')
        .lean();
      data = friends.flatMap((friend) => {
        // The query already matched only these; the helper decides once more,
        // so the answer can't drift from the profile route's rule.
        const birthday = visibleBirthday(friend, 'friend');
        if (!birthday || !friend.username) return [];
        return [
          {
            id: friend._id.toString(),
            username: friend.username,
            image: friend.image ?? null,
            birthday,
          },
        ];
      });
    }

    return NextResponse.json({ success: true, data }, { status: 200, headers: PRIVATE });
  } catch (error) {
    console.error('Error fetching friends’ birthdays:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch birthdays' },
      { status: 500, headers: PRIVATE }
    );
  }
}
