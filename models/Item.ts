import mongoose, { Schema, Model } from 'mongoose';

const ItemSchema = new Schema(
  {
    wishlist: {
      type: Schema.Types.ObjectId,
      ref: 'Wishlist',
      required: true,
    },
    name: { 
      type: String, 
      required: true 
    },
    imageUrl: { 
      type: String, 
      required: true 
    },
    priceInCents: { 
      type: Number,
      required: false
    },
    link: { 
      type: String 
    },
    status: {
      type: String,
      enum: ['available', 'booked', 'completed'],
      required: true,
      default: 'available'
    },
    bookedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster lookups
ItemSchema.index({ wishlist: 1 });

// Base document type
export interface IItem {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  name: string;
  imageUrl: string;
  priceInCents?: number | null;
  link?: string | null;
  status: 'available' | 'booked' | 'completed';
  bookedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;
