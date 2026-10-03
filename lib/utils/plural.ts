/**
 * A count and its noun, agreeing: "1 item", "2 items", "0 items". Use it
 * wherever a number is followed by what it counts, rather than a ternary of
 * your own, so no screen says "1 items" or "1 followers".
 *
 * English only. The plural is worked out from the singular ("gift" → "gifts",
 * "entry" → "entries", "box" → "boxes"), unless the noun is one of the
 * irregulars below or the caller passes its own (`plural(n, 'mouse', 'mice')`).
 */

// Plurals the rules below would get wrong.
const IRREGULAR: Readonly<Record<string, string>> = {
  person: 'people',
  // "3 following": the people someone follows, which doesn't take an "s".
  following: 'following',
};

function pluralOf(noun: string): string {
  const irregular = IRREGULAR[noun];
  if (irregular) return irregular;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/**
 * The noun alone, in the number `n` takes, for a count that's set apart from
 * it (in bold, say): `<b>{n}</b> {pluralNoun(n, 'follower')}`.
 */
export function pluralNoun(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? pluralOf(one));
}

/** "1 item", "12 items", "0 items". */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${pluralNoun(n, one, many)}`;
}
