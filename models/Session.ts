import mongoose, { Schema, Model } from 'mongoose';

const SessionSchema = new Schema(
  {
    sessionToken: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    expires: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Base document type
export interface ISession {
  _id: mongoose.Types.ObjectId;
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expires: Date;
  createdAt: Date;
  updatedAt: Date;
}

const Session: Model<ISession> = mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);

export default Session;

