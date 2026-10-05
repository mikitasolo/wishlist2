#!/usr/bin/env node
// Releases `staging` to production: fast-forwards remote `main` to remote
// `staging` and tags the released commit, in one atomic push. The tag
// (`release-YYYY-MM-DD`, UTC, then `.2`, `.3`… for later releases that day) is
// annotated with the commits it ships, so the newest `release-*` tag is always
// what production runs and the one before it is the rollback target.
//
//   node scripts/release.mjs            release (operator only)
//   node scripts/release.mjs --dry-run  print what would ship and the tag, push nothing
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export const RELEASE_TAG_PREFIX = 'release-';

/** The tag for a release made at `now`, given the tag names that already exist. */
export function nextReleaseTag(existingTags, now = new Date()) {
  const base = `${RELEASE_TAG_PREFIX}${now.toISOString().slice(0, 10)}`;
  const taken = new Set(existingTags);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function release(dryRun) {
  git('fetch', 'origin', '--quiet', '--tags', '--force');
  // Pin the commit once: a PR merged into staging mid-release must not slip into
  // the push without being in the tag's changelog.
  const target = git('rev-parse', 'origin/staging');
  const main = git('rev-parse', 'origin/main');
  if (!isAncestor(main, target)) {
    throw new Error(
      'origin/main is not an ancestor of origin/staging: main only ever fast-forwards.'
    );
  }
  const log = git('log', '--oneline', '--no-merges', `${main}..${target}`);
  if (!log) {
    console.log('Nothing to release: origin/main is already at origin/staging.');
    return;
  }
  const tag = nextReleaseTag(git('tag', '--list', `${RELEASE_TAG_PREFIX}*`).split('\n'));
  console.log(`${tag} → ${target.slice(0, 7)}\n\n${log}\n`);
  if (dryRun) return;

  git('tag', '--annotate', tag, target, '--message', `${tag}\n\n${log}`);
  try {
    // Atomic: main moves and the tag lands together, or neither does.
    git('push', '--atomic', 'origin', `${target}:refs/heads/main`, `refs/tags/${tag}`);
  } catch (error) {
    git('tag', '--delete', tag);
    throw error;
  }
  console.log(`Released ${tag}.`);
}

if (process.argv[1] && basename(process.argv[1]) === 'release.mjs') {
  try {
    release(process.argv.includes('--dry-run'));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
