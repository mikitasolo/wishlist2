import mongoose, { Schema, Model, InferSchemaType } from 'mongoose';

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

// Infer type from schema
type SessionSchemaType = InferSchemaType<typeof SessionSchema>;

// Extend with additional fields that Mongoose adds
export interface ISession extends SessionSchemaType {
  _id: string;
}

const Session: Model<ISession> = mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);

export default Session;

