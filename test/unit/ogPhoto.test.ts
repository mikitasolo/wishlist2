import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { loadCardPhoto, PHOTO_BUDGET_MS, PHOTO_MAX_BYTES } from '@/lib/og/photo';

const STORE = 'teststore';
const OWN = `https://${STORE}.public.blob.vercel-storage.com/uploads/u1/image-abc.webp`;
const BOX = { width: 120, height: 63 };

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', `vercel_blob_rw_${STORE}_secret`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function webp(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#5e5ce6' } })
    .webp()
    .toBuffer();
}

/** The data URI's image, decoded. */
async function decode(src: string) {
  expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
  return sharp(Buffer.from(src.split(',')[1], 'base64')).metadata();
}

describe('loadCardPhoto', () => {
  it('draws nothing for a list or user without an image', async () => {
    expect(await loadCardPhoto(null, BOX)).toEqual({ status: 'none' });
    expect(await loadCardPhoto('', BOX)).toEqual({ status: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A banner or avatar can be any URL a user pasted. Fetching one from the
  // server would let anyone point it at an address of their choosing.
  it.each([
    'https://example.com/cat.webp',
    'http://169.254.169.254/latest/meta-data/',
    `https://other.public.blob.vercel-storage.com/uploads/u1/image.webp`,
    `https://${STORE}.public.blob.vercel-storage.com.evil.com/x.webp`,
  ])('never fetches %s, which is not one of our blobs', async (url) => {
    expect(await loadCardPhoto(url, BOX)).toEqual({ status: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // regression: uploads are stored as WebP, which next/og can't draw, so the
  // earlier photo cards failed in production and were dropped.
  it('converts our WebP to a JPEG cropped to the box', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await webp())));
    const photo = await loadCardPhoto(OWN, BOX);
    expect(photo.status).toBe('ok');
    const meta = await decode((photo as { src: string }).src);
    expect(meta).toMatchObject({ format: 'jpeg', width: BOX.width, height: BOX.height });
    expect(fetchMock).toHaveBeenCalledWith(OWN, expect.objectContaining({ redirect: 'error' }));
  });

  it('fails on an answer that is not a 200', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response('gone', { status: 404 }));
    expect(await loadCardPhoto(OWN, BOX)).toEqual({ status: 'failed' });
  });

  it('fails on bytes that are not an image', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response('<html>not an image</html>'));
    expect(await loadCardPhoto(OWN, BOX)).toEqual({ status: 'failed' });
  });

  it('refuses a body that says it is too big, without reading it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = new ReadableStream({ pull: () => expect.fail('the body was read') });
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { 'content-length': String(PHOTO_MAX_BYTES + 1) } })
    );
    expect(await loadCardPhoto(OWN, BOX)).toEqual({ status: 'failed' });
  });

  it('stops reading a body that grows past the limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    fetchMock.mockResolvedValue(new Response(body));
    expect(await loadCardPhoto(OWN, BOX)).toEqual({ status: 'failed' });
    expect(sent).toBeLessThanOrEqual(PHOTO_MAX_BYTES + 2 * chunk.byteLength);
  });

  it('gives up on a photo that takes too long', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockReturnValue(new Promise(() => {}));
    const photo = loadCardPhoto(OWN, BOX);
    await vi.advanceTimersByTimeAsync(PHOTO_BUDGET_MS);
    expect(await photo).toEqual({ status: 'failed' });
  });

  // The blob's path carries the uploader's user id.
  it('logs a failure without the URL', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${OWN}`));
    expect(await loadCardPhoto(OWN, BOX)).toEqual({ status: 'failed' });
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('uploads/');
  });
});
