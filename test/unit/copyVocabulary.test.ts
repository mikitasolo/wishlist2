import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { sourceFiles } from '../sourceFiles';

/** Whether `node` is inside a `console.*(…)` call: a log line, which no user reads. */
function inLog(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'console'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Every string literal and JSX text in `file` that could be copy, as
 * `file:line text`. Left out: imports, log lines, and lower-case single words,
 * which are values and names (`'booked'`, `'completed'`), not copy.
 */
function strings(file: string): string[] {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text.replace(/\s+/g, ' ').trim();
    const copy = text !== null && (ts.isJsxText(node) || /\s|^[A-Z]/.test(text.trim()));
    if (copy && !ts.isImportDeclaration(node.parent) && !inLog(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      out.push(`${path.relative(process.cwd(), file)}:${line + 1} ${text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// The bookmarklet's generated code (`lib/bookmarklet/code.ts`) is minified
// script, not copy: it holds schema.org's `Book` type, not a word a user reads.
const GENERATED = path.join(process.cwd(), 'lib', 'bookmarklet', 'code.ts');
const ALL = ['app', 'components', 'lib'].flatMap((dir) =>
  sourceFiles(path.join(process.cwd(), dir))
    .filter((file) => file !== GENERATED)
    .flatMap(strings)
);
const textOf = (s: string) => s.slice(s.indexOf(' ') + 1);

// regression: one act had several names on one path (Book, Booked, claimed,
// Reserved; Mark as gifted next to Mark as completed; "Only me" and "Private"
// for a list its members can open). D1 settled one word for each (see
// AGENTS.md); the stored names (`booked`, `completed`, `private`) are internal
// and don't change.
describe('the D1 vocabulary', () => {
  it('reads the app’s copy, labels and JSX text alike', () => {
    const texts = ALL.map(textOf);
    expect(texts).toContain('Reserved by you');
    expect(texts).toContain('Mark as given');
    expect(texts).toContain('Invite only');
  });

  it.each([
    ['Book / Unbook / Booked / booking', /\b(book|unbook|booked|booking|bookings)\b/i],
    ['"gifted"', /\bgifted\b/i],
    ['"Mark as completed" / "Completed"', /\bcompleted\b/i],
    ['"Only me"', /\bonly me\b/i],
    ['"Private" as a tier', /\bPrivate\b/],
    ['"claimed"', /\bclaimed\b/i],
  ])('no string a user reads says %s', (_name, pattern) => {
    expect(ALL.filter((s) => pattern.test(textOf(s)))).toEqual([]);
  });

  it('ends a pending label in "…", never "..."', () => {
    expect(ALL.filter((s) => /[a-z]\.\.\.($|[\s'"<])/i.test(textOf(s)))).toEqual([]);
  });
});
