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
 * Race a promise against a timeout. OG images are fetched by crawlers and must
 * render within the serverless function's duration limit — a hung DB connect or
 * a slow upstream image would otherwise turn into a 500. On timeout the promise
 * rejects so callers fall back to a fast, static card.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('og-timeout')), ms)),
  ]);
}
