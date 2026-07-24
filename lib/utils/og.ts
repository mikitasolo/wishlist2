// Gradients for Open Graph images. next/og (Satori) can't render the layered
// radial+linear "mesh" gradients in cover.ts, so OG images use a simpler
// two-stop linear gradient. We index into the same-length palette with the same
// hash, so a wishlist's share image loosely echoes its in-app cover.

const OG_GRADIENTS: Array<[string, string]> = [
  ['#ff7eb3', '#ff5c8a'],
  ['#4facfe', '#5b6cff'],
  ['#38d39f', '#2bb6c9'],
  ['#7b6cff', '#b45cff'],
  ['#ff5f6d', '#b45cff'],
  ['#2bd0c0', '#3a7bd5'],
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Deterministic OG gradient for a seed (e.g. wishlist id or username). */
export function ogGradient(seed: string): { from: string; to: string; css: string } {
  const [from, to] = OG_GRADIENTS[hash(seed || 'wishlist') % OG_GRADIENTS.length];
  return { from, to, css: `linear-gradient(135deg, ${from}, ${to})` };
}

/**
 * Fetch a remote image and return it as a data URI for embedding in an OG image
 * (Satori can render a data: URI reliably). Returns null on any problem — a bad
 * fetch, a non-image response, or an oversized file — so callers can fall back
 * to a gradient instead of failing the whole image render.
 */
export async function fetchImageDataUri(
  url: string | null | undefined,
  maxBytes = 6 * 1024 * 1024
): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
