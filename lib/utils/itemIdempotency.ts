import { createHash } from 'crypto';
/**
 * Idempotent item creation (WIS-158). The wishlist page gives up on a request
 * after `ITEM_REQUEST_TIMEOUT_MS`, but the abandoned POST may still have been
 * saved, so a retry from the still-open dialog would add a second copy. The
 * page sends one key per dialog submission in this header, the same on every
 * retry of it, and `POST /api/wishlists/[id]/items` answers a key it has seen
 * on that list with the item the first attempt made. The header's name is in
 * `submissionKey.ts`, which the browser imports and this module's hash can't be.
 */
import { IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';

export { IDEMPOTENCY_HEADER };

/** What the client may send: a UUID fits, and nothing that needs escaping. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * The request's key: `null` when it sent none (the create isn't idempotent
 * then, as before), `undefined` when it sent one that isn't a key.
 */
export function readIdempotencyKey(headers: Headers): string | null | undefined {
  const key = headers.get(IDEMPOTENCY_HEADER);
  if (key === null) return null;
  return KEY_PATTERN.test(key) ? key : undefined;
}

/**
 * What an item stores: the key scoped to who sent it. The key is chosen by the
 * client, so anyone can send anyone else's; hashed with the sender's id, the
 * same key from another account is a different value and never finds their
 * item, and the stored value names nobody.
 */
export function scopedIdempotencyKey(userId: string, key: string): string {
  return createHash('sha256').update(`${userId}:${key}`).digest('hex');
}

/** Whether `error` is the unique index refusing a second item for one key. */
export function isIdempotencyKeyClash(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyPattern } = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  return code === 11000 && !!keyPattern && 'idempotencyKey' in keyPattern;
}
