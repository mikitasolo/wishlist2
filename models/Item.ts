import mongoose, { Schema, Model } from 'mongoose';

export interface IItem {
  _id: string;
  name: string;
  imageUrl: string;
  price?: string;
  link?: string;
  status: 'available' | 'booked' | 'completed';
  bookedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ItemSchema = new Schema<IItem>(
  {
    name: { 
      type: String, 
      required: true 
    },
    imageUrl: { 
      type: String, 
      required: true 
    },
    price: { 
      type: String 
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

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;

