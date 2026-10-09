import mongoose, { Schema, Model } from 'mongoose';
import {
  notificationPrefsMongooseShape,
  type NotificationPrefs,
} from '@/lib/utils/notificationPrefs';
import {
  BIRTHDAY_VISIBILITIES,
  DEFAULT_BIRTHDAY_VISIBILITY,
  type BirthdayVisibility,
} from '@/lib/utils/birthday';
import type { WalkthroughState } from '@/lib/utils/walkthrough';

export type InvitePolicy = 'everyone' | 'friends' | 'nobody';
export type ProfileVisibility = 'everyone' | 'friends';

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerified: {
      type: Date,
      required: false,
    },
    // Public identity, which every account has (WIS-357): the adapter's
    // `createUser` generates one at sign-up. Lowercased; validated at the API
    // layer. `sparse` stays only so the deployed `username_1` index keeps the
    // options it was built with (Mongoose never rebuilds an index whose options
    // changed, and an index that differed would need a migration); with the
    // field required it indexes every row anyway.
    username: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    // Optional profile photo (Vercel Blob URL). Displayed in avatars.
    image: {
      type: String,
      default: null,
    },
    // Short public bio shown on the profile page.
    bio: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    // Their birthday (WIS-323): a day and a month, `YYYY-MM-DD` on
    // `YEARLY_PLACEHOLDER_YEAR` (`normalizeBirthday`, applied by
    // `updateProfileSchema`), never a real year. Absent or null when not set.
    // Independent of any list's occasion. Only ever answered to someone else
    // through `visibleBirthday` / `birthdayVisibleFilter` (lib/utils/birthday.ts).
    birthday: {
      type: String,
      default: null,
    },
    // Preferred currency (uppercase code, e.g. "USD"). Used as the default for
    // new wishlists and to convert prices when viewing others' lists.
    defaultCurrency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
    },
    // When they answered the dashboard's one-time currency prompt, either way
    // (components/CurrencyPrompt.tsx), or first saved a currency in Settings.
    // PATCH /api/users/me stamps it with `$min`, and nothing clears it. Absent
    // until then, never null: `$min` stamps a missing field, but would keep a
    // null (null sorts before every date), so it has no default.
    currencyChosenAt: {
      type: Date,
    },
    // Privacy preferences (see the settings page).
    privacy: {
      searchable: { type: Boolean, default: true },
      whoCanInvite: {
        type: String,
        enum: ['everyone', 'friends', 'nobody'],
        default: 'everyone',
      },
      profileVisibility: {
        type: String,
        enum: ['everyone', 'friends'],
        default: 'everyone',
      },
      // Who besides them sees their birthday, never wider than
      // `profileVisibility` allows (`birthdayAudience`).
      birthdayVisibility: {
        type: String,
        enum: BIRTHDAY_VISIBILITIES,
        default: DEFAULT_BIRTHDAY_VISIBILITY,
      },
    },
    // Which notifications they get, per event and channel
    // (lib/utils/notificationPrefs.ts). No defaults here: a setting never
    // saved is absent and reads as its default there (`wantsNotification`,
    // `notificationOptInFilter`), so changing a default later reaches every
    // account that never touched it.
    notificationPrefs: notificationPrefsMongooseShape(),
    // The guided walkthrough (WIS-371, lib/utils/walkthrough.ts): when they
    // finished or skipped which version of the tour, and when they were last
    // offered it (back after three months away) and answered that offer.
    // Their own only: `GET /api/users/me` answers what's due, never this.
    walkthrough: {
      version: { type: Number },
      completedAt: { type: Date },
      skippedAt: { type: Date },
      offeredAt: { type: Date },
      offerAnsweredAt: { type: Date },
    },
    // When they last used the app, to the day: bumped at most once a day by
    // `GET /api/users/me` (`activityBumps`), for the walkthrough's re-offer.
    // Absent until their first visit after it shipped.
    lastActiveAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export interface IUserPrivacy {
  searchable: boolean;
  whoCanInvite: InvitePolicy;
  profileVisibility: ProfileVisibility;
  birthdayVisibility?: BirthdayVisibility;
}

// Base document type
export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  emailVerified?: Date | null;
  username: string;
  image?: string | null;
  bio?: string | null;
  birthday?: string | null;
  defaultCurrency?: string;
  currencyChosenAt?: Date;
  privacy?: IUserPrivacy;
  notificationPrefs?: NotificationPrefs;
  walkthrough?: WalkthroughState;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// The daily birthday cron looks people up by the birthdays due in a window:
// friends' reminders (WIS-345, `birthdaysDueForReminder`) and the nudge
// email (WIS-344, `sendBirthdayNudgeEmails`).
UserSchema.index({ birthday: 1 });

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
