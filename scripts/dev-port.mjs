#!/usr/bin/env node
// Picks this checkout's dev and E2E ports, so agent workspaces running side by
// side never fight over one. The main checkout keeps 3000 (dev) and 3100 (E2E).
// A linked git worktree (an agent workspace) gets a pair of its own, worked out
// from its path: the same every time, with nothing to set or store. `DEV_PORT`
// overrides the dev port (E2E then takes the one above it), and `E2E_PORT` the
// E2E port.
//
//   node scripts/dev-port.mjs          prints the dev port (`npm run dev` uses it)
//   node scripts/dev-port.mjs --check  exits 1 if another worktree got the same pair
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MAIN_DEV_PORT = 3000;
export const MAIN_E2E_PORT = 3100;
const WORKTREE_BASE = 3200;
const WORKTREE_SLOTS = 400; // pairs from 3200/3201 to 3998/3999

// No `import.meta` here: Playwright compiles this file to CommonJS when its
// config imports it. npm runs scripts from the repo root, and the config passes
// its own directory.
/** A linked worktree's `.git` is a file pointing at the main repo; the main checkout's is a directory. */
export function isLinkedWorktree(root) {
  try {
    return statSync(join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

/** FNV-1a: a stable, well-spread hash of a worktree's path. */
function hashPath(path) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The dev / E2E pair for a checkout at `root`, before any override. */
export function defaultPorts(root, linkedWorktree) {
  if (!linkedWorktree) return { dev: MAIN_DEV_PORT, e2e: MAIN_E2E_PORT };
  const dev = WORKTREE_BASE + 2 * (hashPath(root) % WORKTREE_SLOTS);
  return { dev, e2e: dev + 1 };
}

/**
 * This checkout's ports, with `DEV_PORT` / `E2E_PORT` applied.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root] the checkout's root directory
 */
export function workspacePorts(env = process.env, root = process.cwd()) {
  const ports = defaultPorts(root, isLinkedWorktree(root));
  const dev = env.DEV_PORT ? Number(env.DEV_PORT) : ports.dev;
  const e2e = env.E2E_PORT ? Number(env.E2E_PORT) : env.DEV_PORT ? dev + 1 : ports.e2e;
  return { dev, e2e };
}

/** The other worktrees of this repo whose default pair is the same as `root`'s. */
function clashingWorktrees(root) {
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  });
  const roots = list
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const own = defaultPorts(root, true).dev;
  return roots.filter(
    (other) => other !== root && isLinkedWorktree(other) && defaultPorts(other, true).dev === own
  );
}

if (process.argv[1] && basename(process.argv[1]) === 'dev-port.mjs') {
  const root = process.cwd();
  if (process.argv.includes('--check')) {
    const clashes = isLinkedWorktree(root) ? clashingWorktrees(root) : [];
    if (clashes.length > 0) {
      console.error(`Port clash with ${clashes.join(', ')}: set DEV_PORT in this workspace.`);
      process.exit(1);
    }
  } else {
    console.log(workspacePorts(process.env, root).dev);
  }
}
