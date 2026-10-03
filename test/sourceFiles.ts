import { readdirSync } from 'fs';
import path from 'path';

/**
 * Every .ts/.tsx file under `dir`, recursively: for the tests that scan the
 * app's own source (status colours, log lines, the type scale, the copy).
 */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
