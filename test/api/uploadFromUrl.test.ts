import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

// POST /api/upload/from-url (WIS-366). The fetch itself is `safeFetch`'s, with
// its own tests; here it's mocked, and the real sharp pipeline runs on what it
// "returned". Storage, the session and the quota lookup are mocked.
const { put, fetchPublicBytes } = vi.hoisted(() => ({
  put: vi.fn(),
  fetchPublicBytes: vi.fn(),
}));
vi.mock('@vercel/blob', () => ({ put }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/blob', () => ({
  USER_UPLOAD_QUOTA_BYTES: 100 * 1024 * 1024,
  getUserUploadBytes: vi.fn(),
}));
vi.mock('@/lib/utils/safeFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/safeFetch')>()),
  fetchPublicBytes,
}));

import { auth } from '@/lib/auth';
import { getUserUploadBytes } from '@/lib/utils/blob';
import { SafeFetchError, type SafeFetchFailure } from '@/lib/utils/safeFetch';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { POST } from '@/app/api/upload/from-url/route';

const session = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const quotaUsed = vi.mocked(getUserUploadBytes);
const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
const IMAGE_URL = 'https://cdn.shop.example/p/alice-wedding-ring.jpg';
const PAGE_URL = 'https://shop.example/p/123?u=alice';
const GENERIC = { success: false, error: "Couldn't fetch the image" };
const BLOB_URL = 'https://store.public.blob.vercel-storage.com/uploads/x/image-abc.png';

function post(body: unknown) {
  return new NextRequest('http://localhost/api/upload/from-url', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#5e5ce6' } })
    .png()
    .toBuffer();

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
const logged = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

beforeEach(() => {
  session.mockReset();
  session.mockResolvedValue({ user: { id: USER_ID, newAccount: false } });
  put.mockReset();
  put.mockResolvedValue({ url: BLOB_URL });
  fetchPublicBytes.mockReset();
  quotaUsed.mockReset();
  quotaUsed.mockResolvedValue(0);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

/** Refused with the one generic answer, nothing stored, and no URL in the logs. */
async function expectGeneric(res: Response, status = 422) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual(GENERIC);
  expect(put).not.toHaveBeenCalled();
  expect(logged()).not.toContain('shop.example');
  expect(logged()).not.toContain('alice');
}

describe('POST /api/upload/from-url', () => {
  it('refuses a signed-out caller without fetching anything', async () => {
    session.mockResolvedValue(null);
    const res = await POST(post({ url: IMAGE_URL }));
    expect(res.status).toBe(401);
    expect(fetchPublicBytes).not.toHaveBeenCalled();
  });

  it('re-hosts the image in the caller’s uploads folder, answering as /api/upload does', async () => {
    fetchPublicBytes.mockResolvedValue(await png());

    const res = await POST(post({ url: IMAGE_URL, page: PAGE_URL }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, url: BLOB_URL });
    expect(fetchPublicBytes).toHaveBeenCalledWith(IMAGE_URL, {
      referer: PAGE_URL,
      maxBytes: 4 * 1024 * 1024,
    });
    expect(put).toHaveBeenCalledTimes(1);
    const [path, data, options] = put.mock.calls[0];
    expect(path).toBe(`uploads/${USER_ID}/image.png`);
    expect(options).toMatchObject({ contentType: 'image/png', addRandomSuffix: true });
    // Re-encoded by sharp, not stored as fetched.
    expect((await sharp(data).metadata()).format).toBe('png');
  });

  it('decides the type from the bytes, never from what the server said', async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    fetchPublicBytes.mockResolvedValue(jpeg);
    const res = await POST(post({ url: 'https://cdn.example.com/looks-like.png' }));
    expect(res.status).toBe(200);
    expect(put.mock.calls[0][0]).toBe(`uploads/${USER_ID}/image.jpg`);
  });

  it.each([
    ['HTML', Buffer.from('<!doctype html><html><body>404</body></html>')],
    ['an SVG', SVG],
    ['nothing', Buffer.alloc(0)],
    [
      'a PNG signature on junk',
      Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(64, 7)]),
    ],
  ])('refuses %s with the generic answer', async (_, bytes) => {
    fetchPublicBytes.mockResolvedValue(bytes);
    await expectGeneric(await POST(post({ url: IMAGE_URL, page: PAGE_URL })));
    expect(quotaUsed).not.toHaveBeenCalled();
  });

  it.each<SafeFetchFailure>([
    'invalid_url',
    'dns',
    'blocked_address',
    'too_many_redirects',
    'bad_status',
    'too_large',
    'timeout',
    'network',
  ])('answers a %s failure exactly like every other, logging only the reason', async (reason) => {
    fetchPublicBytes.mockRejectedValue(new SafeFetchError(reason));
    await expectGeneric(await POST(post({ url: IMAGE_URL, page: PAGE_URL })));
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'upload_from_url_refused', reason }));
  });

  it('answers an unexpected fetch error with the generic answer too', async () => {
    fetchPublicBytes.mockRejectedValue(new Error(`connect ECONNREFUSED 10.0.0.1:443 ${IMAGE_URL}`));
    await expectGeneric(await POST(post({ url: IMAGE_URL })));
    expect(logged()).not.toContain('10.0.0.1');
  });

  it.each([
    ['no body', 'not json'],
    ['no url', { page: PAGE_URL }],
    ['a url that isn’t a string', { url: ['https://a.example/x.png'] }],
  ])('refuses %s with the generic answer, fetching nothing', async (_, body) => {
    await expectGeneric(await POST(post(body)), 400);
    expect(fetchPublicBytes).not.toHaveBeenCalled();
  });

  it('respects the upload quota', async () => {
    fetchPublicBytes.mockResolvedValue(await png());
    quotaUsed.mockResolvedValue(100 * 1024 * 1024);
    const res = await POST(post({ url: IMAGE_URL }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/Upload quota reached/);
    expect(put).not.toHaveBeenCalled();
  });

  it('answers a storage failure with a 500 that logs neither the URL nor the user', async () => {
    fetchPublicBytes.mockResolvedValue(await png());
    put.mockRejectedValue(new Error(`BlobError: uploads/${USER_ID}/image.png`));
    const res = await POST(post({ url: IMAGE_URL }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Upload failed. Please try again.' });
    expect(logged()).not.toContain(USER_ID);
    expect(logged()).not.toContain('shop.example');
  });

  describe('rate limits', () => {
    const allow = (spent: string[], name: string): RateLimiter => ({
      async limit() {
        spent.push(name);
        return { success: true, reset: Date.now() + 60_000, limit: 20, remaining: 19 };
      },
    });
    const deny: RateLimiter = {
      async limit() {
        return { success: false, reset: Date.now() + 60_000, limit: 20, remaining: 0 };
      },
    };

    it('spends its own budget and the upload one', async () => {
      const spent: string[] = [];
      __setRateLimiters({
        uploadFromUrl: allow(spent, 'uploadFromUrl'),
        upload: allow(spent, 'upload'),
      });
      fetchPublicBytes.mockResolvedValue(await png());
      expect((await POST(post({ url: IMAGE_URL }))).status).toBe(200);
      expect(spent).toEqual(['uploadFromUrl', 'upload']);
    });

    it('stops at its own limit before fetching', async () => {
      const spent: string[] = [];
      __setRateLimiters({ uploadFromUrl: deny, upload: allow(spent, 'upload') });
      const res = await POST(post({ url: IMAGE_URL }));
      expect(res.status).toBe(429);
      expect(fetchPublicBytes).not.toHaveBeenCalled();
      expect(spent).toEqual([]);
    });

    it('stops at the upload limit before storing anything', async () => {
      __setRateLimiters({ uploadFromUrl: allow([], 'uploadFromUrl'), upload: deny });
      fetchPublicBytes.mockResolvedValue(await png());
      const res = await POST(post({ url: IMAGE_URL }));
      expect(res.status).toBe(429);
      expect(put).not.toHaveBeenCalled();
    });

    it('spends no upload on a URL that yields no image', async () => {
      const spent: string[] = [];
      __setRateLimiters({
        uploadFromUrl: allow(spent, 'uploadFromUrl'),
        upload: allow(spent, 'upload'),
      });
      fetchPublicBytes.mockRejectedValueOnce(new SafeFetchError('blocked_address'));
      expect((await POST(post({ url: IMAGE_URL }))).status).toBe(422);
      fetchPublicBytes.mockResolvedValueOnce(Buffer.from('<html></html>'));
      expect((await POST(post({ url: IMAGE_URL }))).status).toBe(422);
      expect(spent).toEqual(['uploadFromUrl', 'uploadFromUrl']);
    });

    it('holds a new account to the stricter tier', async () => {
      session.mockResolvedValue({ user: { id: USER_ID, newAccount: true } });
      const spent: string[] = [];
      __setRateLimiters({
        uploadFromUrl: allow(spent, 'uploadFromUrl'),
        upload: allow(spent, 'upload'),
        'uploadFromUrl:new': deny,
        'upload:new': allow(spent, 'upload:new'),
      });
      const res = await POST(post({ url: IMAGE_URL }));
      expect(res.status).toBe(429);
      expect(fetchPublicBytes).not.toHaveBeenCalled();
      expect(spent).toEqual([]);
    });
  });
});
