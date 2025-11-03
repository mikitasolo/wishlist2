import mongoose, { Schema, Model } from 'mongoose';

export interface IItem {
  _id?: string;
  name: string;
  imageUrl: string;
  price?: string;
  link?: string;
  isCompleted: boolean;
  isBooked: boolean;
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
    isCompleted: { 
      type: Boolean, 
      required: true, 
      default: false 
    },
    isBooked: { 
      type: Boolean, 
      required: true, 
      default: false 
    },
  },
  {
    timestamps: true,
  }
);

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;

