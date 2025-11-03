import mongoose, { Schema, Model } from 'mongoose';

export interface IUser {
  _id?: string;
  email: string;
  role: 'user' | 'admin';
  isInvited: boolean;
  invitedBy?: string; // Admin email who invited this user
  createdAt?: Date;
  updatedAt?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      required: true,
    },
    isInvited: {
      type: Boolean,
      default: false,
      required: true,
    },
    invitedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;

