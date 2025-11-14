/**
 * Request deduplication utility
 * Prevents duplicate concurrent API calls
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
const REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * Deduplicates requests by caching promises for the same endpoint
 * @param key - Unique key for the request (usually URL + method)
 * @param requestFn - Function that returns a promise for the request
 * @returns Promise that resolves when request completes
 */
export async function deduplicateRequest<T>(
  key: string,
  requestFn: () => Promise<T>
): Promise<T> {
  // Check if there's already a pending request
  const existing = pendingRequests.get(key);
  
  if (existing) {
    // Check if request is still valid (not too old)
    const age = Date.now() - existing.timestamp;
    if (age < REQUEST_TIMEOUT) {
      return existing.promise as Promise<T>;
    } else {
      // Request is too old, remove it
      pendingRequests.delete(key);
    }
  }

  // Create new request
  const promise = requestFn()
    .then((result) => {
      // Remove from pending requests when completed
      pendingRequests.delete(key);
      return result;
    })
    .catch((error) => {
      // Remove from pending requests on error
      pendingRequests.delete(key);
      throw error;
    });

  // Store pending request
  pendingRequests.set(key, {
    promise,
    timestamp: Date.now(),
  });

  return promise;
}

/**
 * Creates a deduplication key from request details
 */
export function createRequestKey(url: string, method: string = 'GET', body?: unknown): string {
  const bodyStr = body ? JSON.stringify(body) : '';
  return `${method}:${url}:${bodyStr}`;
}

/**
 * Clears all pending requests (useful for testing or cleanup)
 */
export function clearPendingRequests(): void {
  pendingRequests.clear();
}

