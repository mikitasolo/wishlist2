import { encode } from 'uqr';

/** The blank margin the QR spec asks for around the code, in modules. */
export const QR_QUIET_ZONE = 4;

/** A QR code as one SVG path: `size` modules square, quiet zone included. */
export interface QrShape {
  /** The side in modules, the quiet zone on both sides included. */
  size: number;
  /** Every dark module as a 1×1 square, in module units. */
  path: string;
}

/**
 * The QR code for `text`, drawn in the browser (WIS-328) so a share link's
 * token never goes to a third party. Error correction M (15%), which survives
 * a crease or a smudge on a printed card while keeping a `/l/` URL's code
 * small.
 */
export function qrShape(text: string): QrShape {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // One run per row's stretch of dark modules keeps the path short.
      if (!data[y][x] || (x > 0 && data[y][x - 1])) continue;
      let run = 1;
      while (x + run < size && data[y][x + run]) run++;
      path += `M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${run}v1h-${run}z`;
    }
  }
  return { size: size + 2 * QR_QUIET_ZONE, path };
}

/** A standalone SVG file of the code: black on white, `px` pixels square. */
export function qrSvgFile({ size, path }: QrShape, px = 512): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

/** A download's file name from the list's name: "Anna's wedding" → "annas-wedding-qr". */
export function qrFileName(listName: string): string {
  const base = listName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base || 'wishlist'}-qr`;
}
