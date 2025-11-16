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
      required: false
    },
    priceInCents: { 
      type: Number,
      required: false
    },
    link: { 
      type: String 
    },
    notes: {
      type: String,
      maxlength: 100
    },
    status: {
      type: String,
      enum: ['draft', 'available', 'booked', 'completed', 'proposed'],
      required: true,
      default: 'available'
    },
    bookedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    proposedBy: {
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
  imageUrl?: string | null;
  priceInCents?: number | null;
  link?: string | null;
  notes?: string | null;
  status: 'draft' | 'available' | 'booked' | 'completed' | 'proposed';
  bookedBy?: mongoose.Types.ObjectId | null;
  proposedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;
