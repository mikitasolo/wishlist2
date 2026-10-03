import mongoose, { Schema, Model } from 'mongoose';
import { ITEM_NOTES_MAX } from '@/lib/utils/itemFields';

const ItemSchema = new Schema(
  {
    wishlist: {
      type: Schema.Types.ObjectId,
      ref: 'Wishlist',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    imageUrl: {
      type: String,
      required: false,
    },
    price: {
      type: new Schema(
        {
          value: {
            type: Number,
            required: true,
            // Value is stored in cents (integer) to avoid precision issues
          },
          currency: {
            type: String,
            required: true,
            lowercase: true, // Store in lowercase to match rates format
          },
        },
        { _id: false } // Don't create _id for nested subdocuments
      ),
      required: false, // Price object itself is optional, but if present, both value and currency are required
    },
    link: {
      type: String,
    },
    notes: {
      type: String,
      maxlength: ITEM_NOTES_MAX,
    },
    // Set by an owner to tell gifters this is a must-have. Items saved before
    // the flag existed have no value, which means false.
    mostWanted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['draft', 'available', 'booked', 'completed', 'proposed'],
      required: true,
      default: 'available',
    },
    bookedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    proposedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
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
  price?: {
    value: number;
    currency: string;
  } | null;
  link?: string | null;
  notes?: string | null;
  mostWanted?: boolean;
  status: 'draft' | 'available' | 'booked' | 'completed' | 'proposed';
  bookedBy?: mongoose.Types.ObjectId | null;
  proposedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;
