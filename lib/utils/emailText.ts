/**
 * Make a user-controlled value safe for a plain-text part of an email (or any
 * line of text we compose around it): one line, no control characters, and its
 * direction can't leak into the text around it.
 *
 * Wishlist names are checked on create and rename (`lib/validations.ts`), but
 * rows saved before those checks weren't migrated, so the email layer defends
 * itself (WIS-293, the email half of WIS-118).
 *
 * - line breaks (including U+2028 / U+2029) and other control characters become
 *   a space, so a value can't add lines of its own;
 * - bidi embeddings, overrides and isolates (U+202A-U+202E, U+2066-U+2069) are
 *   removed, as U+202E would reverse the rest of the line;
 * - ZWJ and ZWNJ stay (emoji sequences and Persian need them);
 * - the result is wrapped in U+2068 ... U+2069, so whatever direction it
 *   carries stays inside it.
 */
const FSI = '\u2068';
const PDI = '\u2069';

export function isolateForText(value: string): string {
  const cleaned = value
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .trim();
  return `${FSI}${cleaned}${PDI}`;
}
