/**
 * The `Idempotency-Key` of an add or propose dialog's submissions (WIS-158).
 * A submission keeps its key until it succeeds, so a retry after a timeout (or
 * a lost response) sends the same one, and the server answers with the item
 * the first attempt saved instead of making a second.
 *
 * "The same submission" is the same fields: a retry with edited fields is a
 * new submission with a new key, so an edit made after a timeout is saved
 * rather than answered with the item as first sent. A success (Keep adding's
 * next item) and closing the dialog (`reset`) start afresh.
 */

/** The header the key goes in (read by `readIdempotencyKey`, lib/utils/itemIdempotency.ts). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** One dialog's keys: see the note at the top of this file. */
export interface SubmissionKeys {
  /** The key to send with `payload`. */
  keyFor(payload: unknown): string;
  /** The submission was saved: the next one gets a new key. */
  reset(): void;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Not a secret, only unique per submission: the server scopes it to the sender.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function createSubmissionKeys(): SubmissionKeys {
  let current: { key: string; payload: string } | null = null;
  return {
    keyFor(payload) {
      const serialized = JSON.stringify(payload);
      if (!current || current.payload !== serialized) {
        current = { key: newKey(), payload: serialized };
      }
      return current.key;
    },
    reset() {
      current = null;
    },
  };
}
