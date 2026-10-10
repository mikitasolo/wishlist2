#!/usr/bin/env node
// Releases `staging` to production: fast-forwards remote `main` to remote
// `staging` and tags the released commit, in one atomic push. The tag
// (`release-YYYY-MM-DD`, UTC, then `.2`, `.3`… for later releases that day) is
// annotated with the commits it ships, so the newest `release-*` tag is always
// what production runs and the one before it is the rollback target.
//
//   node scripts/release.mjs            release (operator only)
//   node scripts/release.mjs --dry-run  print what would ship and the tag, push nothing
//
// After the push lands it posts the changelog to Telegram and moves the issues
// the release closes to Done (scripts/releaseNotify.mjs), using TELEGRAM_BOT_TOKEN /
// TELEGRAM_CHAT_ID / LINEAR_API_KEY from your shell or from the release env file
// (~/.config/wishlist2/release.env, or RELEASE_ENV_FILE); unset, it prints a preview.
// A failure there warns but never fails the release. --dry-run posts nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseEnv } from 'node:util';
import { announceRelease } from './releaseNotify.mjs';

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

// The announcement's secrets live outside the repo, so no worktree's copied
// `.env` ever carries them (the same reasoning as the Blob keys, WIS-221).
export const DEFAULT_RELEASE_ENV_FILE = join(homedir(), '.config', 'wishlist2', 'release.env');

/**
 * Adds the variables in the release env file to `env`, keeping any already set
 * (the shell wins). A missing file is fine; an unreadable one throws, before
 * anything is pushed.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [file]
 */
export function loadReleaseEnv(
  env = process.env,
  file = env.RELEASE_ENV_FILE || DEFAULT_RELEASE_ENV_FILE
) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
  return true;
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

async function release(dryRun) {
  loadReleaseEnv();
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

  // The release has happened: announcing it can only warn, never fail it.
  try {
    const commits = git('log', '--no-merges', '--format=%s%x1f%b%x1e', `${main}..${target}`)
      .split('\x1e')
      .filter((c) => c.trim())
      .map((c) => {
        const [subject, body = ''] = c.trim().split('\x1f');
        return { subject, body };
      });
    const repo = git('remote', 'get-url', 'origin').match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1];
    await announceRelease(commits, {
      title: repo?.split('/')[1],
      compare: repo && {
        url: `https://github.com/${repo}/compare/${main}...${target}`,
        from: main.slice(0, 7),
        to: target.slice(0, 7),
      },
    });
  } catch (error) {
    console.warn(`Warning: release announcement failed: ${error.message}`);
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'release.mjs') {
  release(process.argv.includes('--dry-run')).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
