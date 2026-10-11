import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// regression: `errorKind(err)` returns an object, so interpolating it into a template
// string logged "[object Object]" and dropped the error kind (WIS-446). Pass it as its own
// console argument instead: console.error('what failed:', errorKind(err)).
const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'lib', 'scripts', 'components', 'hooks'];
const SKIP = new Set(['node_modules', '.next']);

function sources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|mjs|js)$/.test(name) ? [full] : [];
  });
}

describe('errorKind in logs', () => {
  it('is never interpolated into a template string', () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((d) => sources(path.join(ROOT, d)))) {
      // Whole-file match, so a `${` and `errorKind(` that Prettier split across lines still count.
      if (/\$\{\s*errorKind\(/.test(readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
