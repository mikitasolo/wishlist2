/**
 * Reading a page's main resource (a wishlist, a profile) from the browser, and
 * telling an answer that will stay the same however often it's asked from one
 * that might not.
 *
 * A route refuses a read with 401, 403 or 404 when what was asked for doesn't
 * exist or is hidden from the viewer (`getWishlistViewAccess`: a missing,
 * private, friends-only or archived list). That's the viewer's answer for as
 * long as nothing changes, so the page says so in place. It never tells those
 * apart, by status or by wording: they're one "not available" state, so a page
 * can't confirm that a hidden list exists. Anything else (a 5xx, a rate limit,
 * a network error, an answer that isn't the route's own JSON) may be gone on
 * the next try, so the page offers one, or a poll keeps what it shows.
 */

/** The statuses a route refuses a read it will keep refusing with. */
const REFUSAL_STATUSES = new Set([401, 403, 404]);

/**
 * Whether a read's answer is the route's own refusal: a 401, 403 or 404 whose
 * body is our JSON `{ success: false }`. A 404 page from the platform (HTML, or
 * anything else) says nothing about the resource, so it isn't one.
 */
export function isRefusal(status: number, body: unknown): boolean {
  return (
    REFUSAL_STATUSES.has(status) &&
    typeof body === 'object' &&
    body !== null &&
    (body as { success?: unknown }).success === false
  );
}

/**
 * A read the route refused (see `isRefusal`). Thrown by reads that otherwise
 * reject with a plain `Error` (`useFetchItems`), so a caller can stop asking.
 */
export class ReadRefusedError extends Error {
  constructor(message = 'Not available') {
    super(message);
    this.name = 'ReadRefusedError';
  }
}

export type ResourceRead<T> =
  /** The route's `data`. */
  | { outcome: 'loaded'; data: T }
  /** Missing or hidden from the viewer, told apart by nothing (see `isRefusal`). */
  | { outcome: 'refused' }
  /** Anything else: worth trying again. `error` is what went wrong, for a log line. */
  | { outcome: 'failed'; error: unknown };

/**
 * GETs one of our JSON routes (`{ success, data }`) and sorts its answer into
 * loaded, refused or failed. Never rejects. `init` adds to the request (a
 * share link's `X-Share-Token` header).
 */
export async function readResource<T>(url: string, init?: RequestInit): Promise<ResourceRead<T>> {
  let status: number;
  let body: unknown;
  try {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    status = response.status;
    body = await response.json();
  } catch (error) {
    return { outcome: 'failed', error };
  }
  if (isRefusal(status, body)) return { outcome: 'refused' };
  const answer = body as { success?: unknown; data?: T } | null;
  if (status >= 200 && status < 300 && answer?.success === true && answer.data != null) {
    return { outcome: 'loaded', data: answer.data };
  }
  return { outcome: 'failed', error: new Error(`Unexpected answer (${status})`) };
}
