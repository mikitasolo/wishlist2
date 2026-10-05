import { describe, it, expect } from 'vitest';
import { nextReleaseTag } from '@/scripts/release.mjs';

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
