import mongoose, { Schema, Model } from 'mongoose';

const WishlistMemberSchema = new Schema(
  {
    wishlist: {
      type: Schema.Types.ObjectId,
      ref: 'Wishlist',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['member'],
      required: true,
      default: 'member',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure a user can only have one role per wishlist
WishlistMemberSchema.index({ wishlist: 1, user: 1 }, { unique: true });
// Index for faster lookups
WishlistMemberSchema.index({ user: 1 });
WishlistMemberSchema.index({ wishlist: 1 });

// Base document type
export interface IWishlistMember {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  role: 'member';
  createdAt: Date;
  updatedAt: Date;
}

const WishlistMember: Model<IWishlistMember> =
  mongoose.models.WishlistMember ||
  mongoose.model<IWishlistMember>('WishlistMember', WishlistMemberSchema);

export default WishlistMember;
