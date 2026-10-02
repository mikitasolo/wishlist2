/**
 * The image formats `POST /api/upload` accepts, and the checks that bind a
 * file's declared type to the decoder that actually reads it (WIS-157).
 *
 * sharp (libvips) picks its decoder from the bytes, never from the MIME type
 * the client declares, so an allowlist of `file.type` alone only chooses the
 * encoder: an SVG, TIFF or HEIC sent as `image/png` would still be decoded by
 * librsvg, libtiff or libheif. The route checks both sides of the decode:
 * `hasDeclaredSignature` on the leading bytes before sharp sees them, so only
 * the declared type's loader ever gets the file, and `decodedAsDeclared` on
 * what sharp's own sniff reports, before any pixels are decoded.
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
