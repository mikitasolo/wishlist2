import mongoose, { Schema, Model } from 'mongoose';

/**
 * A directed follow edge: `follower` follows `following`.
 * Two users are "friends" when both directions exist (mutual follow).
 */
const FollowSchema = new Schema(
  {
    follower: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    following: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// One edge per (follower, following)
FollowSchema.index({ follower: 1, following: 1 }, { unique: true });
FollowSchema.index({ following: 1 });

export interface IFollow {
  _id: mongoose.Types.ObjectId;
  follower: mongoose.Types.ObjectId;
  following: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const Follow: Model<IFollow> =
  mongoose.models.Follow || mongoose.model<IFollow>('Follow', FollowSchema);

export default Follow;
