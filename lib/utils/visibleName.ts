// Checks for a name that is one line of visible text (wishlist and item names).
// Pure and dependency-free, so a form can run the same checks as the schemas.

// Any control character (Unicode Cc: CR, LF, tab, NUL, NEL, …) or the Unicode
// line and paragraph separators.
export const LINE_BREAK_OR_CONTROL_CHAR = /[\p{Cc}\p{Zl}\p{Zp}]/u;

// The bidi embeddings and overrides (U+202A–U+202E) and isolates
// (U+2066–U+2069). They reorder the text after them, so a name holding one can
// make the rest of an email's line read as something else (a domain spelled
// backwards, say). The bidi marks (LRM, RLM, ALM) only nudge neutral characters
// and stay allowed, as does right-to-left text itself.
export const BIDI_CONTROL_CHAR = /[‪-‮⁦-⁩]/u;

// Unicode's Default_Ignorable_Code_Point: every character that renders as
// nothing (zero-width space and joiners, word joiner, BOM, bidi marks,
// variation selectors, tag characters, Hangul fillers, soft hyphen). Visibly
// blank characters outside that set (U+2800 BRAILLE PATTERN BLANK) still pass.
const INVISIBLE_CHAR = /\p{Default_Ignorable_Code_Point}/gu;

/** Whether a name shows nothing at all: only whitespace and invisible characters. */
export function isVisiblyBlank(name: string): boolean {
  return name.replace(INVISIBLE_CHAR, '').trim() === '';
}

export const NAME_CONTROL_CHAR_MESSAGE = "Name can't contain line breaks or control characters";
export const NAME_BIDI_MESSAGE = "Name can't contain hidden text-direction characters";

/** What's wrong with an already-trimmed name beyond being blank, or null. */
export function nameCharacterProblem(name: string): string | null {
  if (LINE_BREAK_OR_CONTROL_CHAR.test(name)) return NAME_CONTROL_CHAR_MESSAGE;
  if (BIDI_CONTROL_CHAR.test(name)) return NAME_BIDI_MESSAGE;
  return null;
}
