import { describe, it, expect, vi } from 'vitest';
import { createMutationTracker } from '@/lib/utils/mutationTracker';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// A tracker on a clock the test moves by hand, starting at 1_000.
function trackerAt() {
  let clock = 1_000;
  const tracker = createMutationTracker(() => clock);
  return {
    tracker,
    at(time: number) {
      clock = time;
    },
  };
}

describe('createMutationTracker', () => {
  it('keeps every poll before the first mutation', () => {
    const { tracker } = trackerAt();
    expect(tracker.isStale(1_000)).toBe(false);
  });

  // regression: a poll was dropped only if the latest mutation stamp was later
  // than its start, so one that started after an update did and landed before
  // its PATCH settled was applied and flipped the item back.
  it('regression: drops a poll that lands while a mutation is in flight, even one started after it', () => {
    const { tracker, at } = trackerAt();
    void tracker.track(() => new Promise(() => {}));

    at(1_010);
    expect(tracker.isStale(1_010)).toBe(true);
    expect(tracker.isStale(900)).toBe(true);
  });

  it('drops a poll that read across a mutation that has since settled', async () => {
    const { tracker, at } = trackerAt();
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    at(1_050);
    request.resolve();
    await settled;

    expect(tracker.isStale(1_010)).toBe(true);
    expect(tracker.isStale(1_049)).toBe(true);
  });

  it('keeps a poll that started once the mutation settled', async () => {
    const { tracker, at } = trackerAt();
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    at(1_050);
    request.resolve();
    await settled;

    expect(tracker.isStale(1_050)).toBe(false);
    expect(tracker.isStale(1_060)).toBe(false);
  });

  // The default clock is a sequence, not wall-clock milliseconds, so a read and
  // a settle in the same millisecond still come in the order they happened.
  it('orders a read sent right before a settle before it, and one sent right after after it', async () => {
    const tracker = createMutationTracker();
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    const before = tracker.stamp();
    request.resolve();
    await settled;
    // handleUpdateItem's reconcile read after a failed update goes out as soon
    // as the tracked request resolves.
    const after = tracker.stamp();

    expect(tracker.isStale(before)).toBe(true);
    expect(tracker.isStale(after)).toBe(false);
  });

  it('compares stamps across trackers, as a remounted page can join a read its last instance sent', async () => {
    const previous = createMutationTracker();
    const current = createMutationTracker();

    const sentByPrevious = previous.stamp();
    await current.track(async () => 'edited');

    expect(current.isStale(sentByPrevious)).toBe(true);
    expect(current.isStale(previous.stamp())).toBe(false);
  });

  it('stays stale until every overlapping mutation has settled', async () => {
    const { tracker, at } = trackerAt();
    const first = deferred();
    const second = deferred();
    const firstSettled = tracker.track(() => first.promise);
    const secondSettled = tracker.track(() => second.promise);

    at(1_050);
    first.resolve();
    await firstSettled;
    expect(tracker.isStale(1_060)).toBe(true);

    at(1_100);
    second.resolve();
    await secondSettled;
    expect(tracker.isStale(1_060)).toBe(true);
    expect(tracker.isStale(1_100)).toBe(false);
  });

  it('resolves with what the mutation resolved with', async () => {
    const { tracker } = trackerAt();
    await expect(tracker.track(async () => 42)).resolves.toBe(42);
  });

  it('counts a mutation that rejects as settled, and rejects with its error', async () => {
    const { tracker, at } = trackerAt();
    const error = new Error('Failed to update item');

    at(1_050);
    await expect(tracker.track(() => Promise.reject(error))).rejects.toBe(error);

    expect(tracker.isStale(1_010)).toBe(true);
    expect(tracker.isStale(1_050)).toBe(false);
  });

  it('counts a mutation that throws before returning a promise as settled', async () => {
    const { tracker } = trackerAt();
    const error = new Error('boom');

    await expect(
      tracker.track(() => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(tracker.isStale(1_000)).toBe(false);
  });
});

// A tracker with a re-read set, as the page's polling sets one.
function trackerWithReread(reread: () => void) {
  const tracker = createMutationTracker();
  tracker.setReread(reread);
  return tracker;
}

describe('rereadWhenIdle', () => {
  it('re-reads straight away when no mutation is in flight', () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);

    tracker.rereadWhenIdle();

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('waits for the mutation in flight, then re-reads once it has settled', async () => {
    // The read it sends has to count as fresh.
    const reread = vi.fn(() => expect(tracker.isStale(tracker.stamp())).toBe(false));
    const tracker = trackerWithReread(reread);
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    tracker.rereadWhenIdle();
    expect(reread).not.toHaveBeenCalled();

    request.resolve();
    await settled;
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('re-reads once a mutation that rejects has settled too, and keeps its rejection', async () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);
    const error = new Error('Failed to update item');
    const failed = tracker.track(() => Promise.reject(error));

    tracker.rereadWhenIdle();
    await expect(failed).rejects.toBe(error);

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('waits for the last of several overlapping mutations', async () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);
    const first = deferred();
    const second = deferred();
    const firstSettled = tracker.track(() => first.promise);
    const secondSettled = tracker.track(() => second.promise);

    tracker.rereadWhenIdle();
    first.resolve();
    await firstSettled;
    expect(reread).not.toHaveBeenCalled();

    second.resolve();
    await secondSettled;
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('re-reads once however many reads are dropped meanwhile', async () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    tracker.rereadWhenIdle();
    tracker.rereadWhenIdle();
    tracker.rereadWhenIdle();
    request.resolve();
    await settled;

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('re-reads only once: a later settle does not run it again', async () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);
    const first = deferred();
    const firstSettled = tracker.track(() => first.promise);

    tracker.rereadWhenIdle();
    first.resolve();
    await firstSettled;
    await tracker.track(async () => 'another edit');

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while a mutation is stalled, however long it takes', async () => {
    vi.useFakeTimers();
    try {
      const reread = vi.fn();
      const tracker = trackerWithReread(reread);
      void tracker.track(() => new Promise(() => {}));

      tracker.rereadWhenIdle();
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(reread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing while no re-read is set, even once one is', async () => {
    const tracker = createMutationTracker();
    expect(() => tracker.rereadWhenIdle()).not.toThrow();

    const request = deferred();
    const settled = tracker.track(() => request.promise);
    tracker.rereadWhenIdle();
    const reread = vi.fn();
    tracker.setReread(reread);
    request.resolve();
    await settled;

    expect(reread).not.toHaveBeenCalled();
  });

  // The page clears it when its polling stops (Manage opened, or the page left).
  it('drops a waiting re-read once cleared, and asking again then does nothing', async () => {
    const reread = vi.fn();
    const tracker = trackerWithReread(reread);
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    tracker.rereadWhenIdle();
    tracker.setReread(null);
    // A read still in flight when the polling stopped lands stale later.
    tracker.rereadWhenIdle();
    request.resolve();
    await settled;
    tracker.rereadWhenIdle();

    expect(reread).not.toHaveBeenCalled();
  });
});
