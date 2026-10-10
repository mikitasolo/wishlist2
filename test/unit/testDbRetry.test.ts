import { describe, it, expect, vi } from 'vitest';
import { retryOnPortInUse } from '../db';

// regression: parallel test files raced for mongod's random port, and a
// "Port … already in use" start failed the suite and refused a release (WIS-413).
describe('retryOnPortInUse', () => {
  const portInUse = () => new Error('Port "59638" already in use');

  it('starts again on a port-in-use failure', async () => {
    const start = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(portInUse())
      .mockResolvedValueOnce('ok');
    await expect(retryOnPortInUse(start)).resolves.toBe('ok');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt', async () => {
    const start = vi.fn<() => Promise<string>>().mockRejectedValue(portInUse());
    await expect(retryOnPortInUse(start, 3)).rejects.toThrow('already in use');
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('rethrows any other failure at once', async () => {
    const start = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('no binary'));
    await expect(retryOnPortInUse(start)).rejects.toThrow('no binary');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
