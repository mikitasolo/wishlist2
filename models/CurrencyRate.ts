import mongoose, { Schema, Model } from 'mongoose';

const CurrencyRateSchema = new Schema(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      // Format: YYYY-MM-DD
    },
    rates: {
      type: Map,
      of: Number,
      required: true,
      // Map of currency codes to exchange rates (base: USD)
      // Example: { "eur": 0.85, "gbp": 0.73, "jpy": 110.0, "usd": 1.0 }
    },
  },
  {
    timestamps: true,
  }
);

// Base document type
export interface ICurrencyRate {
  _id: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD format
  rates: Map<string, number>; // Currency code -> rate (base: USD)
  createdAt: Date;
  updatedAt: Date;
}

const CurrencyRate: Model<ICurrencyRate> =
  mongoose.models.CurrencyRate || mongoose.model<ICurrencyRate>('CurrencyRate', CurrencyRateSchema);

export default CurrencyRate;
