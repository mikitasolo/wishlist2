import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { sourceFiles } from '../sourceFiles';

// A trailing "…" is only for a pending label ("Saving…"). On a placeholder, or on
// an action ("Delete"), it only reads as cut off.
const ELLIPSIS_PLACEHOLDER = /placeholder\s*[=:]\s*\{?\s*(['"`])[^'"`]*(…|\.\.\.)\1/g;

// A menu item's `label`, or one of the confirmations' action words, ending in "…".
const ELLIPSIS_ACTION =
  /(?:\blabel\s*[=:]\s*\{?\s*(['"`])[^'"`]*(?:…|\.\.\.)\1)|(?:\b(?:Release|Decline|Delete|Leave list|Make member|Make owner|Remove|Archive|Share)(?:…|\.\.\.))/g;

describe('placeholder copy', () => {
  // regression: the header search read "Search people & wishlists…", which
  // looked like a truncated string (WIS-310).
  it('ends no placeholder in an ellipsis', () => {
    const offenders = ['app', 'components'].flatMap((dir) =>
      sourceFiles(path.join(process.cwd(), dir)).flatMap((file) =>
        (readFileSync(file, 'utf8').match(ELLIPSIS_PLACEHOLDER) ?? []).map(
          (hit) => `${path.relative(process.cwd(), file)}: ${hit}`
        )
      )
    );
    expect(offenders).toEqual([]);
  });

  it('catches an ellipsis placeholder, as a prop or an option', () => {
    for (const source of [
      'placeholder="Search…"',
      "placeholder={'Search...'}",
      "placeholder: 'Type a name…'",
    ]) {
      expect(source.match(ELLIPSIS_PLACEHOLDER)).not.toBeNull();
    }
    expect('placeholder="Search items"'.match(ELLIPSIS_PLACEHOLDER)).toBeNull();
  });
  // regression: menu items and buttons that open a confirmation read "Remove…",
  // "Delete…", which looked like truncated text; only a pending label keeps its
  // "…" (WIS-317).
  it('ends no action label in an ellipsis', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((dir) =>
      sourceFiles(path.join(process.cwd(), dir)).flatMap((file) =>
        (readFileSync(file, 'utf8').match(ELLIPSIS_ACTION) ?? []).map(
          (hit) => `${path.relative(process.cwd(), file)}: ${hit}`
        )
      )
    );
    expect(offenders).toEqual([]);
  });

  it('catches an ellipsis action label, but not a pending one', () => {
    for (const source of [
      "label: 'Remove…'",
      "label: 'Make owner...'",
      '>Delete…<',
      "'Leave list…'",
    ]) {
      expect(source.match(ELLIPSIS_ACTION)).not.toBeNull();
    }
    for (const source of ["label: 'Remove'", "'Removing…'", "'Making member…'", "'Saving…'"]) {
      expect(source.match(ELLIPSIS_ACTION)).toBeNull();
    }
  });
});
