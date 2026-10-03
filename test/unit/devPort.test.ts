import { describe, it, expect } from 'vitest';
import { MAIN_DEV_PORT, MAIN_E2E_PORT, defaultPorts, workspacePorts } from '@/scripts/dev-port.mjs';

const WORKTREE = '/Users/someone/orca/workspaces/wishlist2/booby';

describe('defaultPorts', () => {
  it('keeps the main checkout on 3000 / 3100', () => {
    expect(defaultPorts('/Users/someone/Projects/wishlist2', false)).toEqual({
      dev: MAIN_DEV_PORT,
      e2e: MAIN_E2E_PORT,
    });
  });

  it('gives a worktree the same pair every time, E2E one above dev, inside 3200–3999', () => {
    const ports = defaultPorts(WORKTREE, true);
    expect(defaultPorts(WORKTREE, true)).toEqual(ports);
    expect(ports.e2e).toBe(ports.dev + 1);
    expect(ports.dev % 2).toBe(0);
    expect(ports.dev).toBeGreaterThanOrEqual(3200);
    expect(ports.e2e).toBeLessThanOrEqual(3999);
  });

  it('spreads worktrees over different pairs', () => {
    const devs = new Set(
      ['booby', 'falcon', 'heron', 'kestrel', 'osprey'].map(
        (name) => defaultPorts(`/Users/someone/orca/workspaces/wishlist2/${name}`, true).dev
      )
    );
    expect(devs.size).toBe(5);
  });
});

describe('workspacePorts', () => {
  // The repo root a test runs in may be either kind of checkout, so compare
  // with whatever it defaults to there.
  const defaults = workspacePorts({});

  it('lets DEV_PORT move dev, with E2E one above it', () => {
    expect(workspacePorts({ DEV_PORT: '4100' })).toEqual({ dev: 4100, e2e: 4101 });
  });

  it('lets E2E_PORT move E2E alone', () => {
    expect(workspacePorts({ E2E_PORT: '4200' })).toEqual({ dev: defaults.dev, e2e: 4200 });
    expect(workspacePorts({ DEV_PORT: '4100', E2E_PORT: '4200' })).toEqual({
      dev: 4100,
      e2e: 4200,
    });
  });
});
