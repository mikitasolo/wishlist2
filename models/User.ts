import mongoose, { Schema, Model } from 'mongoose';

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
  privacy?: IUserPrivacy;
  createdAt: Date;
  updatedAt: Date;
}

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
