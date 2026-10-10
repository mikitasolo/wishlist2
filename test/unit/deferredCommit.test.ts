import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredQueue, restoreRemoved, UNDO_WINDOW_MS } from '@/lib/utils/deferredCommit';

describe('createDeferredQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits once the undo window has passed, not before', async () => {
    const queue = createDeferredQueue();
    const commit = vi.fn();
    const pending = queue.defer({ commit });
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    expect(pending.isPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ keepalive: false });
    await expect(pending.settled).resolves.toBe('committed');
    expect(queue.size()).toBe(0);
  });

  it('never commits an undone action, and runs its onUndo once', async () => {
    const queue = createDeferredQueue();
    const commit = vi.fn();
    const onUndo = vi.fn();
    const pending = queue.defer({ commit, onUndo });
    expect(pending.undo()).toBe(true);
    expect(pending.undo()).toBe(false);
    pending.flush();
    queue.flushAll(true);
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledTimes(1);
    await expect(pending.settled).resolves.toBe('undone');
  });

  it('commits at most once, however it is flushed', () => {
    const queue = createDeferredQueue();
    const commit = vi.fn();
    const onUndo = vi.fn();
    const pending = queue.defer({ commit, onUndo });
    pending.flush();
    pending.flush();
    queue.flushAll();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    // Too late to undo: the request has gone.
    expect(pending.undo()).toBe(false);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('flushes everything pending with keepalive when the page goes away', () => {
    const queue = createDeferredQueue();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    queue.defer({ commit: a });
    queue.defer({ commit: b });
    queue.defer({ commit: c }).undo();
    expect(queue.size()).toBe(2);
    queue.flushAll(true);
    expect(a).toHaveBeenCalledWith({ keepalive: true });
    expect(b).toHaveBeenCalledWith({ keepalive: true });
    expect(c).not.toHaveBeenCalled();
    expect(queue.size()).toBe(0);
  });

  it('settles after the commit settles, even when it rejects or throws', async () => {
    const queue = createDeferredQueue();
    let finish!: () => void;
    const slow = queue.defer({ commit: () => new Promise<void>((r) => (finish = r)) });
    const failing = queue.defer({ commit: () => Promise.reject(new Error('nope')) });
    const throwing = queue.defer({
      commit: () => {
        throw new Error('nope');
      },
    });
    let slowSettled = false;
    void slow.settled.then(() => (slowSettled = true));
    queue.flushAll();
    await expect(failing.settled).resolves.toBe('committed');
    await expect(throwing.settled).resolves.toBe('committed');
    expect(slowSettled).toBe(false);
    finish();
    await expect(slow.settled).resolves.toBe('committed');
  });
});

describe('restoreRemoved', () => {
  const a = { _id: 'a' };
  const b = { _id: 'b' };
  const c = { _id: 'c' };
  it('puts an item back where it was', () => {
    expect(restoreRemoved([a, c], b, 1)).toEqual([a, b, c]);
    expect(restoreRemoved([b, c], a, 0)).toEqual([a, b, c]);
  });
  it('appends when the list has shrunk past its place', () => {
    expect(restoreRemoved([a], c, 5)).toEqual([a, c]);
  });
  it('tells entries apart by the key given', () => {
    const list = [{ id: 'x' }, { id: 'z' }];
    expect(restoreRemoved(list, { id: 'y' }, 1, (g) => g.id)).toEqual([
      { id: 'x' },
      { id: 'y' },
      { id: 'z' },
    ]);
    expect(restoreRemoved(list, { id: 'x' }, 0, (g) => g.id)).toBe(list);
  });
  it('leaves a list that has it already alone', () => {
    const list = [a, b];
    expect(restoreRemoved(list, b, 0)).toBe(list);
  });
});
