/**
 * A bound on how long the wishlist page waits for one of its item requests
 * (create, update, delete, propose). Without one, a request that stalls (say,
 * on a dropped connection the browser takes minutes to notice) keeps its card
 * or modal busy for as long as the browser waits. Worse, the page holds off
 * its 5 s poll while an item mutation is in flight (`createMutationTracker`),
 * so the whole list would stay frozen just as long.
 */

/**
 * How long an item request may take before the page gives up on it: 20 s.
 *
 * The slowest normal one is a PATCH that re-prices an item on a cold server.
 * It pays for the function's cold start, a fresh MongoDB connection and the
 * day's first read of the currency rates (fetched from a CDN, with a fallback
 * URL). A booking also copies the item's image, which is capped at 3 s
 * (`SNAPSHOT_COPY_TIMEOUT_MS`). That's a few seconds in all, and the bodies are
 * small JSON (images upload separately), so a slow connection adds little.
 * 20 s leaves a wide margin above that, and a stalled request lets go of the
 * list after a few skipped polls instead of minutes later.
 */
export const ITEM_REQUEST_TIMEOUT_MS = 20_000;

/** The error toast for a request the page gave up on. */
export const REQUEST_TIMEOUT_MESSAGE = 'The request took too long. Please try again.';

/** A request given up on by `withRequestTimeout`. Its message is the toast. */
export class RequestTimeoutError extends Error {
  constructor() {
    super(REQUEST_TIMEOUT_MESSAGE);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Run `request`, and give up on it once `timeoutMs` has passed without it
 * settling: it then rejects with a `RequestTimeoutError`, and the `signal`
 * handed to `request` is aborted, so a `fetch` given that signal drops the
 * connection. The bound covers everything `request` awaits, reading the
 * response body included, not just the wait for the headers.
 *
 * Raced against a timer rather than left to `AbortSignal.timeout`: a signal
 * only stops what reads it, and how its abort surfaces (a `TimeoutError` or
 * `AbortError`, from `fetch` or from the body read) varies by browser. The race
 * settles at the deadline with the one error callers can recognise and show.
 * `AbortController` and `setTimeout` work everywhere, so there's no fallback
 * path to keep. The timer is cleared as soon as `request` settles.
 *
 * Giving up doesn't undo the request: the server may still have done the write.
 * A caller treats a timeout like any other failure, and its reconcile read (or
 * the next poll, which applies again once the request has settled) shows what
 * the server ended up with.
 */
export async function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = ITEM_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new RequestTimeoutError();
      // Rejected before the abort, so the race settles with this error even
      // where the aborted fetch rejects with one of its own.
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
