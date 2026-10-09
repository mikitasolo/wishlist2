import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REHOST_REQUEST_TIMEOUT_MS } from '@/lib/utils/requestTimeout';

describe('REHOST_REQUEST_TIMEOUT_MS', () => {
  // The browser must outlast the route, so a blob the server stored always
  // reaches the flow's hand-back instead of being orphaned by a client timeout.
  it('is longer than the from-url route can run (its maxDuration)', () => {
    const source = readFileSync('app/api/upload/from-url/route.ts', 'utf8');
    const match = /export const maxDuration = (\d+);/.exec(source);
    expect(match).not.toBeNull();
    expect(REHOST_REQUEST_TIMEOUT_MS).toBeGreaterThan(Number(match![1]) * 1000);
  });
});
