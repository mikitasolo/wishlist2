import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { sourceFiles } from '../sourceFiles';

// A trailing "…" means a pending label ("Saving…") or a menu item that opens a
// confirmation ("Delete…"). On a placeholder it only reads as cut off.
const ELLIPSIS_PLACEHOLDER = /placeholder\s*[=:]\s*\{?\s*(['"`])[^'"`]*(…|\.\.\.)\1/g;

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
});
