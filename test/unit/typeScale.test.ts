import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/** Every .ts/.tsx file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('type scale', () => {
  it('defines the type tokens in @theme', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    const theme = css.slice(css.indexOf('@theme {'), css.indexOf('@theme inline'));
    for (const [token, rem] of [
      ['body', '0.9375rem'],
      ['meta', '0.8125rem'],
      ['badge', '0.6875rem'],
      ['title', '1.0625rem'],
    ]) {
      expect(theme).toContain(`--text-${token}: ${rem};`);
      expect(theme).toContain(`--text-${token}--line-height:`);
    }
  });

  // regression: 47 arbitrary sizes (15, 13, 11.5, 11, 10 and 17px) had grown
  // up beside the scale, so one kind of text came in several sizes (DS-8).
  it('leaves no arbitrary text-[Npx] size in the app', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((dir) =>
      sources(path.join(process.cwd(), dir)).flatMap((file) =>
        /text-\[\d+(\.\d+)?(px|rem)\]/.test(readFileSync(file, 'utf8'))
          ? [path.relative(process.cwd(), file)]
          : []
      )
    );
    expect(offenders).toEqual([]);
  });
});
