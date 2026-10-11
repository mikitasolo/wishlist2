import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// regression: `lib/utils/shareLinkFields.ts` imported Zod for its token check,
// and the list page imports it (for SHARE_TOKEN_HEADER), so all of Zod (64 KB
// gzipped, mostly unused) shipped to every list and share-link visitor and held
// back their first paint (WIS-444). This walks the page's static imports, as the
// bundler does (`import type` and lazy `import()` don't ship with the page), and
// fails if any reaches Zod.

const ROOT = process.cwd();
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveModule(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/** The chain of files from `entry` to the first one importing `pkg`, or null. */
function pathToPackage(entry: string, pkg: string): string[] | null {
  const seen = new Set<string>();
  const queue: string[][] = [[join(ROOT, entry)]];
  while (queue.length) {
    const chain = queue.shift()!;
    const file = chain[chain.length - 1];
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (spec === pkg || spec.startsWith(`${pkg}/`))
        return chain.map((f) => f.slice(ROOT.length + 1));
      const next = resolveModule(spec, file);
      if (next) queue.push([...chain, next]);
    }
  }
  return null;
}

describe('the list page bundle', () => {
  it('reaches no Zod through its static imports', () => {
    expect(pathToPackage('components/WishlistPage.tsx', 'zod')).toBeNull();
  });

  it('would notice Zod through a static import (the walker works)', () => {
    expect(pathToPackage('lib/validations.ts', 'zod')).toEqual(['lib/validations.ts']);
  });
});
