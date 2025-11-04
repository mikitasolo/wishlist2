import mongoose, { Schema, Model, InferSchemaType } from 'mongoose';

const ItemSchema = new Schema(
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

// Infer type from schema
type ItemSchemaType = InferSchemaType<typeof ItemSchema>;

// Extend with additional fields that Mongoose adds
export interface IItem extends ItemSchemaType {
  _id: string;
}

const Item: Model<IItem> = mongoose.models.Item || mongoose.model<IItem>('Item', ItemSchema);

export default Item;

