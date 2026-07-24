import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Follow from '@/models/Follow';
import { updateProfileSchema, validateRequestBody } from '@/lib/validations';
import { isReservedUsername } from '@/lib/utils/username';
import { deleteOwnBlob } from '@/lib/utils/blob';

// GET /api/users/me - current user's profile + privacy settings
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const user = await User.findById(session.user.id).select(
      'email username image bio defaultCurrency privacy'
    );
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const [followerCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
    ]);

    return NextResponse.json(
      { success: true, data: { ...user.toObject(), followerCount, followingCount } },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// PATCH /api/users/me - update username and/or privacy settings
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validation = await validateRequestBody(request, updateProfileSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    await connectDB();
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const { username, image, bio, defaultCurrency, privacy } = validation.data;

    if (username && username !== user.username) {
      if (isReservedUsername(username)) {
        return NextResponse.json(
          { success: false, error: 'That username is reserved. Please choose another.' },
          { status: 409 }
        );
      }
      const taken = await User.exists({ username, _id: { $ne: user._id } });
      if (taken) {
        return NextResponse.json(
          { success: false, error: 'That username is already taken.' },
          { status: 409 }
        );
      }
      user.username = username;
    }

    // Remember the previous avatar so we can free it after a successful save if
    // this update replaces or clears it (only our own uploads are deleted).
    let previousAvatar: string | null | undefined;
    if (image !== undefined) {
      previousAvatar = user.image;
      user.image = image || null;
    }

    if (bio !== undefined) {
      user.bio = bio || null;
    }

    if (defaultCurrency !== undefined) {
      user.defaultCurrency = defaultCurrency;
    }

    if (privacy) {
      user.privacy = {
        searchable: privacy.searchable ?? user.privacy?.searchable ?? true,
        whoCanInvite: privacy.whoCanInvite ?? user.privacy?.whoCanInvite ?? 'everyone',
        profileVisibility:
          privacy.profileVisibility ?? user.privacy?.profileVisibility ?? 'everyone',
      };
    }

    await user.save();

    if (previousAvatar && previousAvatar !== user.image) {
      await deleteOwnBlob(previousAvatar);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: user._id,
          email: user.email,
          username: user.username,
          image: user.image,
          bio: user.bio,
          defaultCurrency: user.defaultCurrency,
          privacy: user.privacy,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
