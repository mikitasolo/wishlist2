import mongoose, { Schema, Model } from 'mongoose';

/**
 * One request counted by a `fallback` limiter while Redis is down (WIS-457,
 * `lib/rateLimitFallback.ts`): the sign-in limiters count here instead, so a
 * store outage neither locks everyone out of signing in nor lets an email bomb
 * through. Rows are written only during an outage and expire once their window
 * has passed, so the collection is normally empty.
 *
 * `key` is an HMAC of the limiter's name and key (an email or an IP), never the
 * key itself, so the collection holds no address and nothing to link to an
 * account; that's also why account deletion has no step for it.
 */
const RateLimitFallbackHitSchema = new Schema({
  key: { type: String, required: true },
  at: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});

// The count: one key's hits in its window.
RateLimitFallbackHitSchema.index({ key: 1, at: 1 });
RateLimitFallbackHitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IRateLimitFallbackHit {
  _id: mongoose.Types.ObjectId;
  key: string;
  at: Date;
  expiresAt: Date;
}

const RateLimitFallbackHit: Model<IRateLimitFallbackHit> =
  mongoose.models.RateLimitFallbackHit ||
  mongoose.model<IRateLimitFallbackHit>('RateLimitFallbackHit', RateLimitFallbackHitSchema);

export default RateLimitFallbackHit;
