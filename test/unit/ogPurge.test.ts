import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { deleteByTag } = vi.hoisted(() => ({ deleteByTag: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));

import { purgeShareCards, PURGE_BUDGET_MS } from '@/lib/og/purge';

beforeEach(() => {
  deleteByTag.mockReset();
  deleteByTag.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('purgeShareCards', () => {
  it("deletes the lists' and users' cards in one call", async () => {
    await purgeShareCards({ wishlistIds: ['w1', 'w2'], userIds: ['u1'] });
    expect(deleteByTag).toHaveBeenCalledTimes(1);
    expect(deleteByTag).toHaveBeenCalledWith(['og-wishlist-w1', 'og-wishlist-w2', 'og-user-u1']);
  });

  it("deletes share links' cards by their own tag", async () => {
    await purgeShareCards({ wishlistIds: ['w1'], shareLinkIds: ['l1'] });
    expect(deleteByTag).toHaveBeenCalledWith(['og-wishlist-w1', 'og-link-l1']);
  });

  it('does nothing when there is nothing to purge', async () => {
    await purgeShareCards({});
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  // Best-effort: the write it follows has landed, and the card's TTL bounds a
  // missed purge. Never the ids in the log.
  it('logs a failed purge without the ids, and resolves', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteByTag.mockRejectedValue(new Error('purge failed for og-wishlist-w1'));
    await expect(purgeShareCards({ wishlistIds: ['w1'] })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('w1');
  });

  it('gives up on a purge that hangs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    deleteByTag.mockReturnValue(new Promise(() => {}));
    const purge = purgeShareCards({ userIds: ['u1'] });
    await vi.advanceTimersByTimeAsync(PURGE_BUDGET_MS);
    await expect(purge).resolves.toBeUndefined();
  });
});
