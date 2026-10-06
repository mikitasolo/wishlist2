import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const vercelConfig = require('../../vercel.json') as {
  git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  crons?: Array<{ path: string; schedule: string }>;
};

/**
 * Does a push to `branch` start a Vercel deployment? Mirrors Vercel's documented
 * rules for `git.deploymentEnabled`: keys are minimatch globs, a branch no key
 * matches deploys, and one that several keys match deploys if any of them is
 * `true`. Node's `matchesGlob` is minimatch underneath, so `*` stops at a `/`.
 */
function deploys(branch: string): boolean {
  const setting = vercelConfig.git?.deploymentEnabled ?? true;
  if (typeof setting === 'boolean') return setting;
  const matched = Object.entries(setting).filter(([glob]) => path.posix.matchesGlob(branch, glob));
  return matched.length === 0 || matched.some(([, enabled]) => enabled);
}

describe('vercel.json', () => {
  it('deploys staging and production', () => {
    expect(deploys('staging')).toBe(true);
    expect(deploys('main')).toBe(true);
  });

  // regression: the catch-all was `"*": false`, which in minimatch doesn't match
  // across a `/`. Every Linear branch (`nikitasolo1134/wis-<n>-…`) has one, so
  // each PR push was still a deployment and spent the Hobby plan's daily cap.
  it.each([
    'nikitasolo1134/wis-185-stop-vercel-from-deploying-pr-branches-whose-names-contain-a',
    'mikitasolo/todo',
    'dependabot/npm_and_yarn/next-16.3.9',
    'wis-168-nodemailer-10',
    'worktree-agent-a1d02930c4597114d',
    'staging-old',
    'release/main',
  ])('builds no preview for the PR branch %s', (branch) => {
    expect(deploys(branch)).toBe(false);
  });

  // Hobby runs a cron at most once a day, so a more frequent schedule fails the deploy.
  it('runs the monthly snapshot sweep and daily reminders, at most daily, on a route that exists', () => {
    const crons = vercelConfig.crons ?? [];
    expect(crons).toContainEqual({ path: '/api/cron/sweep-snapshots', schedule: '0 3 1 * *' });
    // Daily: a reminder is due a week before, with a two-day catch-up (WIS-193).
    expect(crons).toContainEqual({ path: '/api/cron/occasion-reminders', schedule: '0 6 * * *' });
    expect(crons).toContainEqual({ path: '/api/cron/birthdays', schedule: '15 6 * * *' });
    for (const cron of crons) {
      const [minute, hour] = cron.schedule.split(' ');
      expect(/^\d+$/.test(minute) && /^\d+$/.test(hour)).toBe(true);
      expect(existsSync(path.join(__dirname, '../../app', cron.path, 'route.ts'))).toBe(true);
    }
  });
});
