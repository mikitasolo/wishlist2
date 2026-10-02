import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User, { type IUser } from '@/models/User';
import Follow from '@/models/Follow';
import { updateProfileSchema, validateRequestBody } from '@/lib/validations';
import { isReservedUsername } from '@/lib/utils/username';
import {
  canAttachImage,
  FOREIGN_IMAGE_ERROR,
  freeReplacedImage,
  isSameImage,
  isUploadedBy,
} from '@/lib/utils/blob';

// GET /api/users/me - current user's profile + privacy settings
export async function GET() {
  try {
    const session = await auth();
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
    const session = await auth();
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

    if (!canAttachImage(image, session.user.id, user.image)) {
      return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
    }

    const changes: Partial<
      Pick<IUser, 'username' | 'image' | 'bio' | 'defaultCurrency' | 'privacy'>
    > = {};

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
      changes.username = username;
    }

    // The avatar the profile already has isn't written back: that would undo a
    // replacement from another tab landing after the read above, and restore the
    // avatar it had already freed.
    if (image !== undefined && !isSameImage(image, user.image)) {
      changes.image = image || null;
    }

    if (bio !== undefined) {
      changes.bio = bio || null;
    }

    if (defaultCurrency !== undefined) {
      changes.defaultCurrency = defaultCurrency;
    }

    if (privacy) {
      changes.privacy = {
        searchable: privacy.searchable ?? user.privacy?.searchable ?? true,
        whoCanInvite: privacy.whoCanInvite ?? user.privacy?.whoCanInvite ?? 'everyone',
        profileVisibility:
          privacy.profileVisibility ?? user.privacy?.profileVisibility ?? 'everyone',
      };
    }

    // One write, so an edit that replaces or clears the avatar can free the one
    // it replaced: the write hands back the profile as it was just before it
    // landed. Two tabs replacing the avatar at once both read the same one, and
    // freeing that read leaves the other tab's upload behind, never freed.
    const replacesAvatar = changes.image !== undefined;
    const written = await User.findOneAndUpdate(
      { _id: user._id },
      { $set: changes },
      { returnDocument: replacesAvatar ? 'before' : 'after', runValidators: true }
    );
    if (!written) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    let saved = written;
    if (replacesAvatar) {
      // An avatar has exactly one legitimate uploader, its user, so check that
      // here as well as on write: it keeps a foreign blob URL saved before the
      // write check existed from being freed. (Item images and banners can carry
      // a co-owner's or proposer's upload, so they rely on the write check.)
      if (isUploadedBy(written.image, session.user.id)) {
        await freeReplacedImage(written.image, changes.image);
      }
      const now = await User.findById(user._id);
      if (!now) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
      saved = now;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: saved._id,
          email: saved.email,
          username: saved.username,
          image: saved.image,
          bio: saved.bio,
          defaultCurrency: saved.defaultCurrency,
          privacy: saved.privacy,
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
