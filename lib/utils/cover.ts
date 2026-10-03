/**
 * Deterministic, vibrant "cover art" gradients for wishlists — mesh-style
 * layered gradients (Apple-esque) chosen by a stable hash of a seed string
 * (e.g. the wishlist id or name), so a given list always looks the same.
 */

const covers = [
  'radial-gradient(120% 120% at 18% 18%, #ffd07a 0%, transparent 52%), linear-gradient(135deg, #ff7eb3, #ff5c8a 58%, #ff8f5c)',
  'radial-gradient(120% 120% at 82% 18%, #7af0ff 0%, transparent 52%), linear-gradient(135deg, #4facfe, #5b6cff 70%)',
  'radial-gradient(120% 120% at 28% 24%, #b6ffb0 0%, transparent 52%), linear-gradient(135deg, #38d39f, #2bb6c9 70%)',
  'radial-gradient(120% 120% at 78% 22%, #c6a3ff 0%, transparent 52%), linear-gradient(135deg, #7b6cff, #b45cff 62%, #ff6cae)',
  'radial-gradient(120% 120% at 22% 16%, #ffb27a 0%, transparent 50%), linear-gradient(135deg, #ff5f6d, #ff3d77 60%, #b45cff)',
  'radial-gradient(120% 120% at 80% 20%, #a0f0d0 0%, transparent 52%), linear-gradient(135deg, #2bd0c0, #3a7bd5 75%)',
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Returns a CSS `background` value for the given seed. */
export function coverGradient(seed: string): string {
  return covers[hash(seed || 'wishlist') % covers.length];
}

// The first character as a reader sees it: an emoji with its modifiers and
// joined parts, a flag (two regional indicators), or a letter with its
// combining marks. A regex rather than `Intl.Segmenter`, which a browser may
// lack or segment differently from the server: the server's render and the
// browser's have to agree.
const FIRST_CHARACTER =
  /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]?(?:‍\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]?)*|\P{M}\p{M}*)/u;

/**
 * The letter an item's placeholder cover shows: the first character of its
 * name, upper-cased, as the reader sees it (an emoji, or a letter with its
 * accent, stays whole). `''` for a name with nothing to show.
 */
export function coverInitial(name: string): string {
  const first = name.trim().match(FIRST_CHARACTER)?.[0] ?? '';
  // Not `toLocaleUpperCase()`: the server's locale and the browser's can
  // differ (a Turkish "i"). And one character, never two: a letter whose
  // capital is several ("ß" is "SS") stays as it is.
  const upper = first.toUpperCase();
  return Array.from(upper).length === Array.from(first).length ? upper : first;
}
