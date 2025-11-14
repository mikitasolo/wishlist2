import mongoose, { Schema, Model } from 'mongoose';

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
  },
  {
    timestamps: true,
  }
);

// Base document type
export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  emailVerified?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;

