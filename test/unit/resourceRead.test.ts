import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRefusal, readResource, ReadRefusedError } from '@/lib/utils/resourceRead';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isRefusal', () => {
  it.each([401, 403, 404])("is the route's own %i", (status) => {
    expect(isRefusal(status, { success: false, error: 'Wishlist not found' })).toBe(true);
  });

  it.each([
    ['a 5xx', 500, { success: false, error: 'Failed to fetch wishlist' }],
    ['a rate limit', 429, { success: false, error: 'Too many requests' }],
    ['a 400', 400, { success: false, error: 'Bad request' }],
    ['a success', 200, { success: true, data: {} }],
    ["a 404 that isn't our JSON", 404, 'Not Found'],
    ['a 404 with no body', 404, null],
    ['a 404 that says it succeeded', 404, { success: true }],
  ])('is not %s', (_label, status, body) => {
    expect(isRefusal(status, body)).toBe(false);
  });
});

describe('readResource', () => {
  it('loads the route’s data, read afresh', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: { name: 'Birthday' } }));

    await expect(readResource('/api/wishlists/w1')).resolves.toEqual({
      outcome: 'loaded',
      data: { name: 'Birthday' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists/w1', { cache: 'no-store' });
  });

  // A missing list (404), a private one signed out (401), one hidden from the
  // signed-in viewer (403), an archived one (404): one outcome, with nothing of
  // the route's wording.
  it.each([
    [404, 'Wishlist not found'],
    [401, 'Unauthorized - This wishlist is private'],
    [403, 'Unauthorized - No access to this wishlist'],
  ])('sorts a %i into refused, with nothing to tell them apart', async (status, error) => {
    fetchMock.mockResolvedValue(reply(status, { success: false, error }));

    await expect(readResource('/api/wishlists/w1')).resolves.toEqual({ outcome: 'refused' });
  });

  it.each<[string, () => unknown]>([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => reply(500, { success: false, error: 'Failed to fetch wishlist' })],
    ['a rate limit', () => reply(429, { success: false, error: 'Too many requests' })],
    ["a 404 page that isn't the route's", () => reply(404, '<html>Not Found</html>')],
    ['a 502 page', () => reply(502, '<html>Bad Gateway</html>')],
    ['a 200 that reports a failure', () => reply(200, { success: false, error: 'Nope' })],
    ['a 200 with no data', () => reply(200, { success: true })],
    ['a 2xx-claiming 5xx', () => reply(503, { success: true, data: {} })],
  ])('sorts %s into failed, never rejecting', async (_label, answer) => {
    fetchMock.mockImplementation(answer);

    const read = await readResource('/api/wishlists/w1');
    expect(read.outcome).toBe('failed');
    expect(read).toHaveProperty('error');
  });
});

describe('ReadRefusedError', () => {
  it('is an Error, told apart by its class', () => {
    const error = new ReadRefusedError('Wishlist not found');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ReadRefusedError');
    expect(error.message).toBe('Wishlist not found');
    expect(new ReadRefusedError().message).toBe('Not available');
  });
});
