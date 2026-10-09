import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User, { type IUser, type IUserPrivacy } from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import { deleteAccountSchema, updateProfileSchema, validateRequestBody } from '@/lib/validations';
import { enforce, userKey } from '@/lib/rateLimit';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import {
  deletionConfirmationTarget,
  matchesDeletionConfirmation,
} from '@/lib/utils/deletionConfirmation';
import { errorKind } from '@/lib/utils/errorKind';
import { duplicateKeyField } from '@/lib/utils/mongoErrors';
import { isReservedUsername } from '@/lib/utils/username';
import {
  canAttachImage,
  FOREIGN_IMAGE_ERROR,
  freeReplacedImage,
  isSameImage,
  isUploadedBy,
} from '@/lib/utils/blob';
import { purgeShareCards } from '@/lib/og/purge';
import { notificationPrefWrites } from '@/lib/utils/notificationPrefs';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';
import {
  activityBump,
  walkthroughDue,
  walkthroughVariant,
  walkthroughWrite,
  type WalkthroughStatus,
} from '@/lib/utils/walkthrough';

// GET /api/users/me - current user's profile + privacy settings, and what the
// guided walkthrough has due for them (WIS-371). Every read is a visit: it
// records one first (`recordVisit`), so a visit back after three months away
// is what offers the tour.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    await recordVisit(session.user.id);
    const user = await User.findById(session.user.id).select(
      'email username image bio birthday defaultCurrency privacy notificationPrefs walkthrough'
    );
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const [followerCount, followingCount, ownsAList] = await Promise.all([
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
      Wishlist.exists(ownedByFilter(session.user.id)),
    ]);

    // What's due, never the stored state itself.
    const { walkthrough: tourState, ...profile } = user.toObject();
    const walkthrough: WalkthroughStatus = {
      due: walkthroughDue(tourState),
      variant: walkthroughVariant(!!ownsAList),
    };

    return NextResponse.json(
      { success: true, data: { ...profile, followerCount, followingCount, walkthrough } },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching profile:', errorKind(error));
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}

/**
 * What a save writes: each field it was sent that changes the profile, and each
 * privacy setting it was sent by its own dotted path (`privacy.searchable`).
 */
type ProfileWrite = Partial<
  Pick<IUser, 'username' | 'image' | 'bio' | 'birthday' | 'defaultCurrency'>
> & {
  [K in keyof IUserPrivacy as `privacy.${K}`]?: IUserPrivacy[K];
} & Record<`notificationPrefs.${string}`, boolean>;

// PATCH /api/users/me - update the profile and privacy settings it's sent. The
// settings page sends only what its form changed (`profileChanges`,
// lib/utils/profileSettings.ts), and only that is written: a field left out
// keeps what the profile has by then, even if another tab saved it after the
// read below.
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

    const {
      username,
      image,
      bio,
      birthday,
      defaultCurrency,
      currencyChosen,
      privacy,
      notificationPrefs,
      walkthrough,
    } = validation.data;

    if (!canAttachImage(image, session.user.id, user.image)) {
      return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
    }

    const changes: ProfileWrite = {};

    if (username && username !== user.username) {
      if (isReservedUsername(username)) {
        return NextResponse.json(
          { success: false, error: 'That username is reserved. Please choose another.' },
          { status: 409 }
        );
      }
      // Only a pre-check: two accounts claiming one free username at once both
      // pass it, and the unique index refuses the second write (caught below).
      const taken = await User.exists({ username, _id: { $ne: user._id } });
      if (taken) return usernameTaken();
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

    // Already normalized to a day and month (`birthdaySchema`); null clears it.
    if (birthday !== undefined) {
      changes.birthday = birthday;
    }

    if (defaultCurrency !== undefined) {
      changes.defaultCurrency = defaultCurrency;
    }

    // An answer to the dashboard's currency prompt, stamped with our own clock.
    // A currency saved from Settings is one too: someone who picks USD there has
    // chosen it. `$min` stamps an account that has no answer yet and keeps the
    // earliest one, so a later answer (or two at once) can't move it, and no
    // request can clear it.
    const answered = currencyChosen === true || defaultCurrency !== undefined;

    // Each privacy setting it's sent, on its own: never the whole `privacy`
    // object rebuilt from the read above, which would write back a setting it
    // wasn't sent as that read saw it, undoing another tab's change landing in
    // between (making the profile friends-only, say).
    if (privacy?.searchable !== undefined) {
      changes['privacy.searchable'] = privacy.searchable;
    }
    if (privacy?.whoCanInvite !== undefined) {
      changes['privacy.whoCanInvite'] = privacy.whoCanInvite;
    }
    if (privacy?.profileVisibility !== undefined) {
      changes['privacy.profileVisibility'] = privacy.profileVisibility;
    }
    if (privacy?.birthdayVisibility !== undefined) {
      changes['privacy.birthdayVisibility'] = privacy.birthdayVisibility;
    }
    // Likewise each notification setting, by its own path
    // (`notificationPrefs.occasion_reminder.inApp`).
    Object.assign(changes, notificationPrefWrites(notificationPrefs));

    // An answer from the guided walkthrough, on the server's clock.
    const tourWrite = walkthrough ? walkthroughWrite(walkthrough, new Date()) : undefined;

    // One write, which hands back the profile as it was just before it landed,
    // so what follows works from what it replaced, not from the read above. Two
    // tabs replacing the avatar at once both read the same one, and freeing that
    // read leaves the other tab's upload behind, never freed.
    let before;
    try {
      before = await User.findOneAndUpdate(
        { _id: user._id },
        {
          $set: { ...changes, ...tourWrite?.$set },
          ...(tourWrite && '$unset' in tourWrite && { $unset: tourWrite.$unset }),
          ...(answered && { $min: { currencyChosenAt: new Date() } }),
        },
        { returnDocument: 'before', runValidators: true }
      );
    } catch (error) {
      // Another account took the username between the pre-check and this write:
      // the same answer as the pre-check's (WIS-212).
      if (changes.username !== undefined && duplicateKeyField(error) === 'username') {
        return usernameTaken();
      }
      throw error;
    }
    if (!before) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Their profile's share card shows the username, avatar and (unless the
    // profile is friends-only) the bio, and their lists' cards the username, so
    // a change to any of them drops those cards now that it has landed. Compared
    // with what the write replaced: a value it was sent may be one the profile
    // already had (an older tab's save sends every privacy setting), and one
    // another tab wrote after the read above is what a card may show by now.
    const visibility = changes['privacy.profileVisibility'];
    const cardChanged =
      (changes.username !== undefined && changes.username !== before.username) ||
      (changes.image !== undefined && !isSameImage(changes.image, before.image)) ||
      (changes.bio !== undefined && changes.bio !== (before.bio ?? null)) ||
      (visibility !== undefined &&
        visibility !== (before.privacy?.profileVisibility ?? 'everyone'));
    if (cardChanged) await purgeShareCards({ userIds: [session.user.id] });

    // An avatar has exactly one legitimate uploader, its user, so check that
    // here as well as on write: it keeps a foreign blob URL saved before the
    // write check existed from being freed. (Item images and banners can carry
    // a co-owner's or proposer's upload, so they rely on the write check.)
    if (changes.image !== undefined && isUploadedBy(before.image, session.user.id)) {
      await freeReplacedImage(before.image, changes.image);
    }

    // The profile as it is now, which the settings form refills from.
    const saved = await User.findById(user._id);
    if (!saved) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
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
          birthday: saved.birthday ?? null,
          defaultCurrency: saved.defaultCurrency,
          privacy: saved.privacy,
          // From `toObject()`, which drops the empty object of each event
          // never set, so only saved settings come back (as GET answers).
          notificationPrefs: saved.toObject().notificationPrefs ?? {},
        },
      },
      { status: 200 }
    );
  } catch (error) {
    // Reduced to its kind: a duplicate-key or cast error quotes the value it
    // refused (a username, an email, a user id).
    console.error('Error updating profile:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}

// DELETE /api/users/me - delete the account and everything in it, at once
// (WIS-276). The body confirms it with the username, or the email for an account
// with none, and the cascade is `deleteAccount` (lib/utils/accountDeletion.ts).
// It ends the account's sessions itself, so the page only has to sign out.
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await enforce('accountDelete', userKey(session.user.id));
    if (limited) return limited;

    const validation = await validateRequestBody(request, deleteAccountSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    await connectDB();
    const user = await User.findById(session.user.id).select('username email').lean();
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const target = deletionConfirmationTarget(user);
    if (!matchesDeletionConfirmation(validation.data.confirm, target)) {
      return NextResponse.json(
        {
          success: false,
          error:
            target.kind === 'username'
              ? 'Type your username to confirm'
              : 'Type your email to confirm',
        },
        { status: 400 }
      );
    }

    const result = await deleteAccount(session.user.id, {
      agreedListIds: validation.data.lists,
    });
    if (result === 'lists-changed') {
      // Nothing was changed: a list became theirs alone since the dialog opened.
      return NextResponse.json(
        {
          success: false,
          error: 'Your lists have changed. Check which ones will be deleted, then confirm again.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    // Its kind only: an error here can quote a record of the account's.
    console.error('Error deleting account:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}

/**
 * Records a visit (WIS-371): bumps `lastActiveAt` at most once a day, and, on
 * a visit back after `RETURN_GAP_DAYS` away, offers the tour in the same write
 * (`activityBump`). Best-effort: the profile is answered whether or not it
 * landed.
 */
async function recordVisit(userId: string) {
  try {
    const { filter, update } = activityBump(new Date());
    await User.updateOne({ _id: userId, ...filter }, update);
  } catch (error) {
    console.error('Error recording a visit:', errorKind(error));
  }
}

/** The 409 for a username another account holds, from the pre-check or the write's unique index. */
function usernameTaken() {
  return NextResponse.json(
    { success: false, error: 'That username is already taken.' },
    { status: 409 }
  );
}
