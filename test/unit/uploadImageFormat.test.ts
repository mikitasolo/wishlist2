import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import {
  UPLOAD_IMAGE_TYPES,
  decodedAsDeclared,
  hasDeclaredSignature,
  isUploadImageType,
  sniffsAsSvg,
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

describe('sniffsAsSvg', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';
  const utf8 = (text: string) => Buffer.from(text, 'utf8');
  const before = (prefix: string, rest = SVG) => Buffer.concat([latin1(prefix), latin1(rest)]);

  /**
   * Does the bundled libvips' own sniff hand these bytes to librsvg? With every
   * loader blocked but SVG's, only its `is_a` runs: bytes it claims go on to
   * librsvg (where junk then fails to parse), and any others are refused as an
   * unknown format before a loader runs.
   */
  async function libvipsSniffsAsSvg(bytes: Buffer): Promise<boolean> {
    return sharp(bytes)
      .metadata()
      .then(
        () => true,
        (err: Error) => !/unsupported image format/.test(err.message)
      );
  }

  // `sharp.block` is libvips state for the whole process, and Vitest may run
  // other test files in it, so set exactly the loaders this needs, whatever ran
  // before, and leave libvips as a fresh process has it (nothing blocked).
  beforeAll(() => {
    sharp.block({ operation: ['VipsForeignLoad'] });
    sharp.unblock({ operation: ['VipsForeignLoadSvg'] });
  });
  afterAll(() => {
    sharp.unblock({ operation: ['VipsForeignLoad'] });
  });

  // regression: the SVG loader stays unblocked for next/og, and libvips' SVG
  // sniff accepts a GIF's or WebP's signature followed by text with an `<svg`
  // in it, so such a polyglot was read as a GIF or WebP only because libvips
  // tries those loaders first. A libvips that changed the order would have had
  // librsvg parse the upload (WIS-208).
  it.each([
    ['a GIF', 'image/gif', before('GIF89a')],
    ['a GIF with 24 leading ASCII bytes', 'image/gif', before('GIF89a'.padEnd(24, 'A'))],
    ['a WebP', 'image/webp', before('RIFFAAAAWEBPVP8 ')],
  ] as const)('claims %s that libvips would also read as an SVG', async (_kind, type, polyglot) => {
    expect(hasDeclaredSignature(polyglot, type)).toBe(true);
    expect(await libvipsSniffsAsSvg(polyglot)).toBe(true);
    expect(sniffsAsSvg(polyglot)).toBe(true);
  });

  it('claims no real upload', async () => {
    for (const type of UPLOAD_IMAGE_TYPES) {
      expect(await libvipsSniffsAsSvg(encoded[type]), type).toBe(false);
      expect(sniffsAsSvg(encoded[type]), type).toBe(false);
    }
  });

  // Each case is checked against libvips itself, so a libvips that sniffs
  // differently fails here rather than in production.
  it.each([
    ['an SVG', latin1(SVG), true],
    ['a prolog and an upper-case tag', latin1('<?xml version="1.0"?>\n<!-- x -->\n<SVG/>'), true],
    ['a mixed-case tag', before('GIF89a', '<sVg/>'), true],
    [
      'an SVG after 100 KB of text, since a buffer is searched to its end',
      before('A'.repeat(1e5)),
      true,
    ],
    ['an SVG after multibyte UTF-8', Buffer.concat([utf8('GIF89a é ✓ 😀 '), latin1(SVG)]), true],
    ['an SVG after a byte-order mark', Buffer.concat([utf8('\ufeff'), latin1(SVG)]), true],
    [
      'an SVG after U+FFFE, which glib takes as UTF-8',
      Buffer.concat([utf8('\ufffe'), latin1(SVG)]),
      true,
    ],
    // libvips steps from character to character, skipping continuation bytes.
    ['an SVG after a stray continuation byte', before('GIF89a\x80'), true],
    ['a tag with continuation bytes inside it', latin1('<\x80s\x80v\x80g/>'), true],
    ['an SVG after a NUL', before('GIF89a\x08\x00'), false],
    ['an SVG after a 0xFF byte', before('GIF89a\xff'), false],
    ['an SVG after an overlong NUL', before('GIF89a\xc0\x80'), false],
    ['an SVG after an encoded surrogate', before('GIF89a\xed\xa0\x80'), false],
    ['an SVG after a code point past U+10FFFF', before('GIF89a\xf4\x90\x80\x80'), false],
    ['an SVG after a truncated sequence', before('GIF89a\xc3'), false],
    ['an SVG that starts with a continuation byte', before('\x80'), false],
    ['text with no tag', latin1('GIF89a'.padEnd(64, 'A')), false],
    ['a non-ASCII s', utf8('<\u017fvg/>'), false],
    ['a gzipped SVG (SVGZ)', gzipSync(latin1(SVG)), true],
  ])('agrees with libvips on %s', async (_kind, bytes, svg) => {
    expect(await libvipsSniffsAsSvg(bytes)).toBe(svg);
    expect(sniffsAsSvg(bytes)).toBe(svg);
  });

  // Where it can't follow libvips exactly, it refuses more, never less.
  it.each([
    ['a tag at the very end of the bytes', latin1('GIF89a<svg')],
    ['gzip whose SVG starts past what libvips inflates', gzipSync(before('A'.repeat(2000)))],
    ['gzip too short for libvips to inflate, with no tag', latin1('\x1f\x8b\x08\x00AAAA')],
  ])('claims %s, which libvips does not', async (_kind, bytes) => {
    expect(await libvipsSniffsAsSvg(bytes)).toBe(false);
    expect(sniffsAsSvg(bytes)).toBe(true);
  });

  // Random strings of the bytes the walk treats differently, so a difference
  // from libvips that no case above thought of still shows up.
  it('agrees with libvips on random mixes of text, tags and invalid UTF-8', async () => {
    const tokens = [
      ...['<', 's', 'S', 'v', 'V', 'g', 'G', 'a', ' ', '<svg', '<SVG', '\x00', '\x01', '\x7f'],
      ...['\x80', '\xbf', '\xc3', '\xc3\xa9', '\xe2\x9c\x93', '\xe2\x9c', '\xed\xa0\x80'],
      ...['\xef\xbf\xbd', '\xf0\x9f\x98\x80', '\xf4\x90\x80\x80', '\xc0\xbc', '\xf8\x88\x80\x80'],
      '\xff',
    ];
    let seed = 208;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    let claimed = 0;
    for (let i = 0; i < 400; i++) {
      const parts = Array.from({ length: 1 + random(12) }, () => tokens[random(tokens.length)]);
      // Never a tag at the very end, where `sniffsAsSvg` refuses more on purpose.
      const bytes = latin1(`${parts.join('')} x`);
      const svg = await libvipsSniffsAsSvg(bytes);
      expect(sniffsAsSvg(bytes), JSON.stringify(bytes.toString('latin1'))).toBe(svg);
      if (svg) claimed++;
    }
    // Plenty of both answers, or the comparison proves little.
    expect(claimed).toBeGreaterThan(40);
    expect(claimed).toBeLessThan(360);
  });
});
