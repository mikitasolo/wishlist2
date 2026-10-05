import mongoose, { Schema, Model } from 'mongoose';
import type { NotificationPrefs } from '@/lib/utils/notificationPrefs';

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
    },
    // Which notifications they get, per event and channel
    // (lib/utils/notificationPrefs.ts). No defaults here: a setting never
    // saved is absent and reads as its default there (`wantsNotification`,
    // `notificationOptInFilter`), so changing a default later reaches every
    // account that never touched it.
    notificationPrefs: {
      occasion_reminder: {
        inApp: { type: Boolean },
      },
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
}

// Base document type
export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  emailVerified?: Date | null;
  username?: string | null;
  image?: string | null;
  bio?: string | null;
  defaultCurrency?: string;
  currencyChosenAt?: Date;
  privacy?: IUserPrivacy;
  notificationPrefs?: NotificationPrefs;
  createdAt: Date;
  updatedAt: Date;
}

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
