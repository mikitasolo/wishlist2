import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadReleaseEnv, nextReleaseTag } from '@/scripts/release.mjs';

const NOW = new Date('2026-10-05T23:30:00Z');

describe('nextReleaseTag', () => {
  it("names the day's first release after its UTC date", () => {
    expect(nextReleaseTag([], NOW)).toBe('release-2026-10-05');
    expect(nextReleaseTag(['release-2026-10-04', 'release-2026-10-04.2'], NOW)).toBe(
      'release-2026-10-05'
    );
  });

  it('numbers later releases the same day from .2', () => {
    expect(nextReleaseTag(['release-2026-10-05'], NOW)).toBe('release-2026-10-05.2');
    expect(nextReleaseTag(['release-2026-10-05', 'release-2026-10-05.2'], NOW)).toBe(
      'release-2026-10-05.3'
    );
  });

  it('ignores blank lines from an empty tag list', () => {
    expect(nextReleaseTag([''], NOW)).toBe('release-2026-10-05');
  });
});

describe('loadReleaseEnv', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'release-env-')), 'release.env');
  writeFileSync(file, 'TELEGRAM_BOT_TOKEN=from-file\n# a comment\nLINEAR_API_KEY="quoted"\n');

  it("adds the file's variables without overriding the shell", () => {
    const env: Record<string, string | undefined> = { TELEGRAM_BOT_TOKEN: 'from-shell' };
    expect(loadReleaseEnv(env, file)).toBe(true);
    expect(env).toEqual({ TELEGRAM_BOT_TOKEN: 'from-shell', LINEAR_API_KEY: 'quoted' });
  });

  it('reads the file named by RELEASE_ENV_FILE', () => {
    const env: Record<string, string | undefined> = { RELEASE_ENV_FILE: file };
    expect(loadReleaseEnv(env)).toBe(true);
    expect(env.TELEGRAM_BOT_TOKEN).toBe('from-file');
  });

  it('is a no-op when the file is missing', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadReleaseEnv(env, join(tmpdir(), 'no-such-release.env'))).toBe(false);
    expect(env).toEqual({});
  });
});
