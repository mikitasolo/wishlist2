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
  /**
   * Epoch ms after which the caller has stopped waiting (and refused): a hit
   * written later is taken back, so a slow MongoDB never spends a token for a
   * request that was never let through.
   */
  deadline: number;
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
 * The hit is written first, then ranked among the window's hits by `_id` (a
 * total order), so of requests racing for the last tokens exactly that many
 * are allowed: none slips past the limit, and none is refused for a token that
 * was free. A request turned away takes its hit back, so (as with Upstash's
 * sliding window) refused attempts don't keep a key blocked, and so does one
 * whose caller had given up by the time it was written (`deadline`). Rows
 * expire after their window. Throws if MongoDB fails; the caller then refuses.
 */
export async function fallbackAllows({
  id,
  key,
  tokens,
  windowMs,
  deadline,
}: FallbackLimit): Promise<boolean> {
  await connectDB();
  if (Date.now() > deadline) return false;
  const hashed = fallbackKey(id, key);
  const now = Date.now();
  const hit = await RateLimitFallbackHit.create({
    key: hashed,
    at: new Date(now),
    expiresAt: new Date(now + windowMs),
  });
  const rank = await RateLimitFallbackHit.countDocuments({
    key: hashed,
    at: { $gt: new Date(now - windowMs) },
    _id: { $lte: hit._id },
  });
  if (rank <= tokens && Date.now() <= deadline) return true;
  await RateLimitFallbackHit.deleteOne({ _id: hit._id });
  return false;
}
