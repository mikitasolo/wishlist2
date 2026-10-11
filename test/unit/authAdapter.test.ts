import { describe, it, expect, vi, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';

// regression: lib/authAdapter.ts started `client.connect()` at import. When a
// cold start's connect timed out before anything awaited it, the rejection
// went unhandled (Sentry WISHLIST-3/4), and the rejected promise stayed
// cached, so every Auth.js call on that instance failed after it. Now nothing
// connects until the adapter is used, and a failed connect is retried by the
// next call (on a new client: the driver closes one whose connect failed).

const connect = vi.spyOn(MongoClient.prototype, 'connect');

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Auth.js adapter client', () => {
  it('connects only when used, and retries after a failed connect', async () => {
    // Nothing listens on port 1: every connect fails fast.
    vi.stubEnv('MONGODB_URI', 'mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=100');
    const { adapter } = await import('@/lib/authAdapter');
    expect(connect).not.toHaveBeenCalled();

    await expect(adapter.getUser!('64b7f0c2a1d3e4f5a6b7c8d9')).rejects.toThrow(
      /ECONNREFUSED|Server selection timed out/
    );
    const afterFirst = connect.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await expect(adapter.getUser!('64b7f0c2a1d3e4f5a6b7c8d9')).rejects.toThrow(
      /ECONNREFUSED|Server selection timed out/
    );
    expect(connect.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
