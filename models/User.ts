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
    // Public identity. Unique + sparse so legacy rows without one are allowed
    // until backfilled. Lowercased; validated at the API layer.
    username: {
      type: String,
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
  username?: string | null;
  image?: string | null;
  bio?: string | null;
  birthday?: string | null;
  defaultCurrency?: string;
  currencyChosenAt?: Date;
  privacy?: IUserPrivacy;
  notificationPrefs?: NotificationPrefs;
  createdAt: Date;
  updatedAt: Date;
}

// The daily birthday cron looks people up by the birthdays due in a window:
// friends' reminders (WIS-345, `birthdaysDueForReminder`) and the nudge
// email (WIS-344, `sendBirthdayNudgeEmails`).
UserSchema.index({ birthday: 1 });

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
