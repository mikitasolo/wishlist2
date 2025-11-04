import mongoose, { Schema, Model, InferSchemaType } from 'mongoose';

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
    isArchived: {
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

// Infer type from schema
type UserSchemaType = InferSchemaType<typeof UserSchema>;

// Extend with additional fields that Mongoose adds
export interface IUser extends UserSchemaType {
  _id: string;
}

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;

