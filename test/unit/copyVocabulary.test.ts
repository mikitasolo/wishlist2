import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import ts from 'typescript';

/** Every .ts/.tsx file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Every string literal and JSX text in `file`, as `file:line text`. */
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
    if (text && !ts.isImportDeclaration(node.parent)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      out.push(`${path.relative(process.cwd(), file)}:${line + 1} ${text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const ALL = ['app', 'components', 'lib'].flatMap((dir) =>
  sources(path.join(process.cwd(), dir)).flatMap(strings)
);

// regression: one act had several names on one path (Book, Booked, claimed,
// Reserved; Mark as gifted next to Mark as completed; "Only me" for a list its
// members can open). D1 settled one word for each (see AGENTS.md); the stored
// names (`booked`, `completed`, `private`) are internal and don't change.
describe('the D1 vocabulary', () => {
  it.each([
    ['Book / Unbook / Booked', /\b(Book|Unbook|Booked)\b|\b(book|unbook) (it|this|items?)\b/],
    ['"booked by"', /\bbooked by\b/i],
    ['"gifted"', /\bgifted\b/i],
    ['"Mark as completed" / "Completed"', /\bMark as completed\b|\bCompleted\b/],
    ['"Only me"', /\bonly me\b/i],
    ['"claimed"', /\bclaimed\b/i],
  ])('no string a user reads says %s', (_name, pattern) => {
    expect(ALL.filter((s) => pattern.test(s.slice(s.indexOf(' ') + 1)))).toEqual([]);
  });

  it('ends a pending label in "…", never "..."', () => {
    expect(ALL.filter((s) => /[a-z]\.\.\.($|[\s'"<])/i.test(s.slice(s.indexOf(' ') + 1)))).toEqual(
      []
    );
  });
});
