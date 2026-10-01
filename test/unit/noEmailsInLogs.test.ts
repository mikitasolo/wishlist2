import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * The argument text of every `console.*(…)` call in `source`, up to its matching
 * `)`. Parens inside '…' and "…" strings are skipped; template literals are read
 * as code, so their `${…}` expressions are checked too.
 */
function consoleCallArgs(source: string): string[] {
  return [...source.matchAll(/console\.(?:log|info|warn|error|debug|trace)\(/g)].map((match) => {
    const start = match.index + match[0].length;
    let depth = 1;
    let quote: string | null = null;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    return source.slice(start, i - 1);
  });
}

// A value that is an email by name: a property called `email` (`user.email`,
// `session.user.email`) or a variable called `…Email` (`invitedUserEmail`). That's
// what this guards, and all it guards: a bare `email` isn't matched (lib/email.ts
// uses it for the outgoing message, whose console transport prints its recipient
// by design), and neither is a whole user object or an error that quotes one.
const EMAIL_VALUE = /\.email\b|\b[a-z]\w*Email\b/;

describe('console calls in app/ and lib/', () => {
  // regression: the session callback logged `user.email` when a session's user
  // row was missing. AGENTS.md: never expose user emails, and anyone with project
  // access reads the server log.
  it('regression: none logs a value named email', () => {
    const calls = ['app', 'lib'].flatMap((dir) =>
      sourceFiles(join(ROOT, dir)).flatMap((file) =>
        consoleCallArgs(readFileSync(file, 'utf8')).map((args) => ({
          where: relative(ROOT, file),
          args,
        }))
      )
    );

    // Guards the scan itself: a broken parser would otherwise pass vacuously.
    expect(calls.length).toBeGreaterThan(50);
    expect(calls.some(({ args }) => args.includes('Error in session callback'))).toBe(true);
    expect(calls.filter(({ args }) => EMAIL_VALUE.test(args))).toEqual([]);
  });
});
