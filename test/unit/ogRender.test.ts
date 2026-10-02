import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A fresh copy of the module, so its font cache starts empty. */
async function load() {
  vi.resetModules();
  const [{ renderCardPng, renderCardImage }, { siteCard, wishlistCard }] = await Promise.all([
    import('@/lib/og/render'),
    import('@/lib/og/cards'),
  ]);
  return { renderCardPng, renderCardImage, siteCard, wishlistCard };
}

function expectCardPng(body: ArrayBuffer) {
  const png = Buffer.from(body);
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
}

afterEach(() => {
  vi.doUnmock('node:fs/promises');
  vi.doUnmock('sharp');
  vi.restoreAllMocks();
});

describe('renderCardPng', () => {
  it('draws a card to a 1200×630 PNG with our fonts', async () => {
    const { renderCardPng, wishlistCard } = await load();
    const body = await renderCardPng(
      wishlistCard({
        id: '64f0c0ffee0000000000abcd',
        name: 'День рождения',
        ownerUsername: 'mama',
        count: 3,
        photo: null,
      })
    );
    expectCardPng(body);
  });

  // A font missing from the bundle costs the card its bold text, never the card.
  it('still draws, in the default font, when our fonts are missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('node:fs/promises', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    }));
    const { renderCardPng, siteCard } = await load();
    expectCardPng(await renderCardPng(siteCard()));
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('fonts failed to load'),
      expect.objectContaining({ code: 'ENOENT' })
    );
  });
});

describe('renderCardImage', () => {
  // regression: a card with a photo was megabytes as a PNG, more than WhatsApp
  // shows as a preview image.
  it('serves a card as a JPEG of the same size, a fraction of the PNG', async () => {
    const { renderCardPng, renderCardImage, siteCard } = await load();
    const image = await renderCardImage(siteCard());
    expect(image.contentType).toBe('image/jpeg');
    const bytes = new Uint8Array(image.body);
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1200, height: 630 });
    const png = await renderCardPng(siteCard());
    expect(bytes.byteLength).toBeLessThan(png.byteLength / 2);
  });

  it('sends the PNG when sharp is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('sharp', () => {
      throw new Error('ERR_DLOPEN_FAILED');
    });
    const { renderCardImage, siteCard } = await load();
    const image = await renderCardImage(siteCard());
    expect(image.contentType).toBe('image/png');
    expectCardPng(image.body as ArrayBuffer);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('JPEG encode failed'),
      expect.anything()
    );
  });
});
