import type sharp from 'sharp';

/**
 * The image formats `POST /api/upload` accepts, and the checks that bind a
 * file's declared type to the decoder that actually reads it (WIS-157).
 *
 * sharp (libvips) picks its decoder from the bytes, never from the MIME type
 * the client declares, so an allowlist of `file.type` alone only chooses the
 * encoder: an SVG, TIFF or HEIC sent as `image/png` would still be decoded by
 * librsvg, libtiff or libheif. The route checks both sides of the decode:
 * `hasDeclaredSignature` and `sniffsAsSvg` on the bytes before sharp sees them,
 * so only the declared type's loader ever gets the file (and librsvg never
 * does), and `decodedAsDeclared` on what sharp's own sniff reports, before any
 * pixels are decoded.
 */

export const UPLOAD_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;

export type UploadImageType = (typeof UPLOAD_IMAGE_TYPES)[number];

export function isUploadImageType(type: string): type is UploadImageType {
  return (UPLOAD_IMAGE_TYPES as readonly string[]).includes(type);
}

const bytesOf = (text: string) => Buffer.from(text, 'latin1');
const JPEG = bytesOf('\xff\xd8\xff');
const PNG = bytesOf('\x89PNG\r\n\x1a\n');
const GIF87A = bytesOf('GIF87a');
const GIF89A = bytesOf('GIF89a');
const RIFF = bytesOf('RIFF');
const WEBP = bytesOf('WEBP');
const FTYP = bytesOf('ftyp');
const AVIF_BRANDS = [bytesOf('avif'), bytesOf('avis')];

// libvips' own HEIF sniff refuses a bigger `ftyp` box (and libheif can't read
// one); a real one is a few dozen bytes.
const MAX_FTYP_BYTES = 2048;

/** Do the bytes at `offset` match `signature`? */
function hasAt(bytes: Buffer, signature: Buffer, offset = 0): boolean {
  const end = offset + signature.length;
  return end <= bytes.length && bytes.compare(signature, 0, signature.length, offset, end) === 0;
}

/**
 * An AVIF is an ISO-BMFF file whose leading `ftyp` box lists `avif` (a still
 * image) or `avis` (a sequence) as its major brand or a compatible one. HEIC
 * shares the container but lists `heic`/`mif1` instead, so it's refused here.
 */
function isAvifContainer(bytes: Buffer): boolean {
  if (bytes.length < 16 || !hasAt(bytes, FTYP, 4)) return false;
  // size, 'ftyp', major brand, minor version, then 4-byte compatible brands.
  const boxSize = bytes.readUInt32BE(0);
  if (boxSize < 16 || boxSize > Math.min(bytes.length, MAX_FTYP_BYTES) || boxSize % 4 !== 0) {
    return false;
  }
  const brandOffsets = [8];
  for (let at = 16; at < boxSize; at += 4) brandOffsets.push(at);
  return brandOffsets.some((at) => AVIF_BRANDS.some((brand) => hasAt(bytes, brand, at)));
}

const SIGNATURES: Record<UploadImageType, (bytes: Buffer) => boolean> = {
  'image/jpeg': (bytes) => hasAt(bytes, JPEG),
  'image/png': (bytes) => hasAt(bytes, PNG),
  'image/gif': (bytes) => hasAt(bytes, GIF87A) || hasAt(bytes, GIF89A),
  'image/webp': (bytes) => hasAt(bytes, RIFF) && hasAt(bytes, WEBP, 8),
  'image/avif': isAvifContainer,
};

/**
 * Do the file's leading bytes carry the declared type's signature? Checked
 * before sharp sees the bytes, so content of another format (SVG, TIFF, HEIC,
 * PDF, …) never reaches another format's loader, not even for the header read
 * that `metadata()` does. (HEVC content in a container branded as AVIF still
 * reaches libheif, which is AVIF's own loader; `decodedAsDeclared` refuses it.)
 */
export function hasDeclaredSignature(bytes: Buffer, type: UploadImageType): boolean {
  return SIGNATURES[type](bytes);
}

const GZIP_MAGIC = bytesOf('\x1f\x8b');
const isContinuation = (byte: number) => (byte & 0xc0) === 0x80;

/**
 * The length of the UTF-8 character starting at `at`, or 0 where glib's
 * `g_utf8_get_char_validated` refuses it: a stray continuation byte, a
 * malformed, overlong or truncated sequence, a surrogate, anything past
 * U+10FFFF, and U+0000 (refused since GLib 2.63; sharp bundles 2.90).
 */
function utf8CharLength(bytes: Buffer, at: number): number {
  const lead = bytes[at];
  if (lead === 0) return 0;
  if (lead < 0x80) return 1;
  let length: number;
  let codePoint: number;
  let min: number;
  if (lead >= 0xc0 && lead < 0xe0) [length, codePoint, min] = [2, lead & 0x1f, 0x80];
  else if (lead >= 0xe0 && lead < 0xf0) [length, codePoint, min] = [3, lead & 0x0f, 0x800];
  else if (lead >= 0xf0 && lead < 0xf8) [length, codePoint, min] = [4, lead & 0x07, 0x10000];
  else return 0;
  if (at + length > bytes.length) return 0;
  for (let i = 1; i < length; i++) {
    const next = bytes[at + i];
    if (!isContinuation(next)) return 0;
    codePoint = (codePoint << 6) | (next & 0x3f);
  }
  const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return codePoint < min || codePoint > 0x10ffff || surrogate ? 0 : length;
}

/** `<svg`, lowercase. Only ASCII letters fold to `s`, `v` or `g`, so ASCII is the whole match. */
const SVG_TAG = [0x3c, 0x73, 0x76, 0x67];
const toLowerAscii = (byte: number) => (byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte);

/**
 * Would libvips' SVG loader claim these bytes? Checked before sharp sees an
 * upload, whatever its declared type, so librsvg never parses one: sharp's SVG
 * loader stays unblocked for next/og, which rasterizes every share card with it
 * (see `restrictToUploadLoaders`), and a GIF's or WebP's signature can begin a
 * file that libvips' SVG sniff accepts too. Today libvips tries the GIF and WebP
 * loaders first, but nothing pins that order across upgrades.
 *
 * This mirrors `vips_foreign_load_svg_is_a` (libvips 8.18.7,
 * libvips/foreign/svgload.c), which sharp runs on the whole buffer:
 *
 *     All we do is look for "<svg", any case, within the first
 *     SVG_HEADER_SIZE bytes, where the bytestream up to the "<svg" is
 *     valid utf-8.
 *
 * SVG_HEADER_SIZE (1000) only bounds a file's or stream's sniff: for a buffer,
 * `vips_foreign_find_load_buffer` hands `is_a_buffer` its full length, so the
 * search runs as far as the bytes stay text. Its `vips_utf8_strcasestr` steps
 * from character to character with `g_utf8_find_next_char`, which skips
 * continuation bytes, and gives up at the first character
 * `g_utf8_get_char_validated` refuses (see `utf8CharLength`). A buffer that
 * starts with gzip's magic is inflated first (SVGZ) and its first 1000 bytes
 * searched instead. No accepted format starts with that magic, so rather than
 * inflate it, it's refused outright. Where this differs from libvips at all
 * (an `<svg` at the very end of the bytes, a gzip stream under 18 bytes), it
 * refuses more, never less, and `uploadImageFormat.test.ts` checks it against
 * the bundled libvips' own sniff.
 */
export function sniffsAsSvg(bytes: Buffer): boolean {
  if (hasAt(bytes, GZIP_MAGIC)) return true;
  // How much of `<svg` the characters just walked spell. No letter of it
  // repeats, so a mismatch can only restart the match at a `<`.
  let matched = 0;
  let at = 0;
  while (at < bytes.length) {
    const length = utf8CharLength(bytes, at);
    if (length === 0) return false;
    const char = length === 1 ? toLowerAscii(bytes[at]) : -1;
    matched = char === SVG_TAG[matched] ? matched + 1 : char === SVG_TAG[0] ? 1 : 0;
    if (matched === SVG_TAG.length) return true;
    at += length;
    while (at < bytes.length && isContinuation(bytes[at])) at++;
  }
  return false;
}

/** sharp's `metadata().format` for each type: the name of the loader that read it. */
const DECODER_FORMAT: Record<UploadImageType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'heif',
};

/**
 * Did sharp's own sniff pick the declared type's decoder? `meta` is what
 * `metadata()` returns. AVIF and HEIC share libheif's loader (`heif`), so an
 * AVIF must also report AV1 compression; HEVC (HEIC) is refused.
 */
export function decodedAsDeclared(
  type: UploadImageType,
  meta: { format?: string; compression?: string }
): boolean {
  if (meta.format !== DECODER_FORMAT[type]) return false;
  return type !== 'image/avif' || meta.compression === 'av1';
}

/**
 * The libvips loaders left unblocked once the upload route has loaded: those of
 * the formats it accepts (AVIF is read by HEIF's; an Ultra HDR JPEG falls back
 * to the plain JPEG loader), plus SVG's. SVG's isn't for uploads, which
 * `sniffsAsSvg` keeps away from it: next/og rasterizes every share card's SVG
 * with sharp (`sharp(svg).png()`, whenever sharp loads), and the block is
 * process-wide, so without it every card fails wherever this route has loaded
 * (always in `next start` / `next dev`, and on Vercel when routes share a
 * function). Other sharp code that needs another loader has to be added here.
 */
export const UPLOAD_ROUTE_LOADERS = [
  'VipsForeignLoadJpeg',
  'VipsForeignLoadPng',
  'VipsForeignLoadWebp',
  'VipsForeignLoadNsgif',
  'VipsForeignLoadHeif',
  'VipsForeignLoadSvg',
];

/**
 * Block every libvips loader but `UPLOAD_ROUTE_LOADERS`, process-wide, so
 * libtiff, libultrahdr and any loader a later libvips adds never read an
 * upload, even one that got past the checks above.
 */
export function restrictToUploadLoaders(vips: Pick<typeof sharp, 'block' | 'unblock'>): void {
  vips.block({ operation: ['VipsForeignLoad'] });
  vips.unblock({ operation: UPLOAD_ROUTE_LOADERS });
}
