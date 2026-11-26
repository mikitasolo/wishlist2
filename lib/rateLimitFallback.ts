import { createHmac } from 'node:crypto';
import connectDB from './mongodb';
import RateLimitFallbackHit from '@/models/RateLimitFallbackHit';

/** What a `fallback` limiter counts against while Redis is down. */
export interface FallbackLimit {
  /** The registry name (`signinEmail`, …), so two limiters' keys never share a count. */
  id: string;
  /** The limiter key: an email or `ip:<address>`. Only its HMAC is stored. */
  key: string;
  tokens: number;
  windowMs: number;
}

/**
 * The stored form of a limiter key: an HMAC under the app's secret, so a row
 * can't be turned back into an email or IP by hashing guesses (the IPv4 space
 * is small enough to try whole).
 */
export function fallbackKey(id: string, key: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return createHmac('sha256', secret).update(`${id}\0${key}`).digest('base64url');
}

/**
 * The MongoDB stand-in for a `fallback` limiter (WIS-457), used by
 * `lib/rateLimit.ts` only when Redis threw or timed out: `true` if the request
 * is within `tokens` per `windowMs` for this key.
 *
 * The hit is written first and then the window counted, so two requests racing
 * for the last token both see each other and neither slips past the limit; a
 * request turned away takes its hit back, so (as with Upstash's sliding window)
 * refused attempts don't keep a key blocked. Rows expire after their window.
 * Throws if MongoDB fails; the caller then refuses the request.
 */
export async function fallbackAllows({
  id,
  key,
  tokens,
  windowMs,
}: FallbackLimit): Promise<boolean> {
  await connectDB();
  const hashed = fallbackKey(id, key);
  const now = Date.now();
  const hit = await RateLimitFallbackHit.create({
    key: hashed,
    at: new Date(now),
    expiresAt: new Date(now + windowMs),
  });
  const inWindow = await RateLimitFallbackHit.countDocuments({
    key: hashed,
    at: { $gt: new Date(now - windowMs) },
  });
  if (inWindow <= tokens) return true;
  await RateLimitFallbackHit.deleteOne({ _id: hit._id });
  return false;
}
