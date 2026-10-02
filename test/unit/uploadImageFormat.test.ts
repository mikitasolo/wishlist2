import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import {
  UPLOAD_IMAGE_TYPES,
  decodedAsDeclared,
  hasDeclaredSignature,
  isUploadImageType,
  type UploadImageType,
} from '@/lib/utils/uploadImageFormat';

const latin1 = (text: string) => Buffer.from(text, 'latin1');

/** An ISO-BMFF `ftyp` box: size, 'ftyp', major brand, minor version, compatible brands. */
function ftyp(major: string, compatible: string[], size?: number) {
  const box = latin1(`\0\0\0\0ftyp${major}\0\0\0\0${compatible.join('')}`);
  box.writeUInt32BE(size ?? box.length, 0);
  return Buffer.concat([box, latin1('\0\0\0\x08mdat')]);
}

const solid = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#5e5ce6' } });

// Each accepted type, encoded by sharp itself, as real uploads are.
const encoded = {} as Record<UploadImageType, Buffer>;
beforeAll(async () => {
  encoded['image/jpeg'] = await solid().jpeg().toBuffer();
  encoded['image/png'] = await solid().png().toBuffer();
  encoded['image/webp'] = await solid().webp().toBuffer();
  encoded['image/gif'] = await solid().gif().toBuffer();
  encoded['image/avif'] = await solid().avif().toBuffer();
});

describe('isUploadImageType', () => {
  it('accepts the five upload types and nothing else', () => {
    for (const type of UPLOAD_IMAGE_TYPES) expect(isUploadImageType(type)).toBe(true);
    for (const type of [
      'image/svg+xml',
      'image/heic',
      'image/tiff',
      'image/jpg',
      'IMAGE/PNG',
      '',
    ]) {
      expect(isUploadImageType(type)).toBe(false);
    }
  });
});

describe('hasDeclaredSignature', () => {
  it("matches each type's real encoding, and no other type's", () => {
    for (const declared of UPLOAD_IMAGE_TYPES) {
      for (const actual of UPLOAD_IMAGE_TYPES) {
        expect(hasDeclaredSignature(encoded[actual], declared), `${actual} as ${declared}`).toBe(
          actual === declared
        );
      }
    }
  });

  it('refuses formats no type is accepted for, and empty or truncated files', async () => {
    const others = [
      latin1('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'),
      latin1('<?xml version="1.0"?><svg/>'),
      await solid().tiff().toBuffer(),
      latin1('%PDF-1.7\n'),
      ftyp('heic', ['mif1', 'heic']),
      Buffer.alloc(0),
      latin1('\xff\xd8'),
      latin1('\x89PNG'),
      latin1('RIFF\0\0\0\0WEB'),
      latin1('GIF8'),
    ];
    for (const bytes of others) {
      for (const type of UPLOAD_IMAGE_TYPES) expect(hasDeclaredSignature(bytes, type)).toBe(false);
    }
  });

  it('accepts both GIF versions', () => {
    expect(hasDeclaredSignature(latin1('GIF87a\x08\0\x08\0'), 'image/gif')).toBe(true);
    expect(hasDeclaredSignature(latin1('GIF89a\x08\0\x08\0'), 'image/gif')).toBe(true);
  });

  it('accepts an AVIF by its major brand or a compatible one, still or sequence', () => {
    expect(hasDeclaredSignature(ftyp('avif', ['mif1', 'miaf']), 'image/avif')).toBe(true);
    expect(hasDeclaredSignature(ftyp('mif1', ['miaf', 'avif']), 'image/avif')).toBe(true);
    expect(hasDeclaredSignature(ftyp('avis', ['msf1', 'miaf']), 'image/avif')).toBe(true);
  });

  it('refuses an ftyp box with no AVIF brand, or one that is malformed', () => {
    // HEIC: same container, other brands.
    expect(hasDeclaredSignature(ftyp('heic', ['mif1', 'miaf', 'MiHE']), 'image/avif')).toBe(false);
    // `avif` only where the minor version sits isn't a brand.
    expect(hasDeclaredSignature(latin1('\0\0\0\x10ftypmif1avif'), 'image/avif')).toBe(false);
    // `avif` only past the end of the box isn't one of its brands.
    expect(hasDeclaredSignature(ftyp('mif1', ['miaf', 'avif'], 20), 'image/avif')).toBe(false);
    // A box claiming more bytes than the file has, too few, or not a whole number of brands.
    expect(hasDeclaredSignature(ftyp('avif', ['mif1'], 4096), 'image/avif')).toBe(false);
    expect(hasDeclaredSignature(ftyp('avif', ['mif1'], 12), 'image/avif')).toBe(false);
    expect(hasDeclaredSignature(ftyp('avif', ['mif1'], 22), 'image/avif')).toBe(false);
  });

  // A file can be 4MB, so a box as big as the file would mean scanning a
  // million "brands" per request. libvips won't sniff a bigger one as HEIF.
  it('refuses an ftyp box over 2KB, however many AVIF brands it lists', () => {
    const brands = (count: number) => Array<string>(count).fill('avif');
    expect(hasDeclaredSignature(ftyp('avif', brands((2048 - 16) / 4)), 'image/avif')).toBe(true);
    expect(hasDeclaredSignature(ftyp('avif', brands((2048 - 16) / 4 + 1)), 'image/avif')).toBe(
      false
    );
  });
});

describe('decodedAsDeclared', () => {
  it("accepts the decoder sharp reports for each type's real encoding", async () => {
    for (const type of UPLOAD_IMAGE_TYPES) {
      expect(decodedAsDeclared(type, await sharp(encoded[type]).metadata()), type).toBe(true);
    }
  });

  it('refuses any other decoder', () => {
    expect(decodedAsDeclared('image/png', { format: 'svg' })).toBe(false);
    expect(decodedAsDeclared('image/jpeg', { format: 'png' })).toBe(false);
    expect(decodedAsDeclared('image/gif', { format: 'tiff' })).toBe(false);
    expect(decodedAsDeclared('image/webp', { format: 'heif', compression: 'av1' })).toBe(false);
    expect(decodedAsDeclared('image/png', {})).toBe(false);
  });

  it('accepts HEIF as AVIF only when it is AV1-compressed', () => {
    expect(decodedAsDeclared('image/avif', { format: 'heif', compression: 'av1' })).toBe(true);
    expect(decodedAsDeclared('image/avif', { format: 'heif', compression: 'hevc' })).toBe(false);
    expect(decodedAsDeclared('image/avif', { format: 'heif' })).toBe(false);
  });
});
