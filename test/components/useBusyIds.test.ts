// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useBusyIds } from '@/lib/hooks/useBusyIds';

/** A promise the test settles by hand, standing in for an action's request. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBusyIds() {
  const { result } = renderHook(() => useBusyIds());
  const run = (id: string, fn: () => Promise<unknown>) => result.current.run(id, fn);
  return {
    busy: (id: string) => result.current.busy(id),
    /** `running` as a caller holding on to it from an earlier render sees it. */
    running: result.current.running,
    run,
    /**
     * Calls `run` inside act, so the busy state it sets has rendered. The call's
     * promise comes back wrapped, since awaiting it would wait for the action.
     */
    start: async (id: string, fn: () => Promise<unknown>) => {
      let running!: Promise<void>;
      await act(async () => {
        running = run(id, fn);
      });
      return { running };
    },
  };
}

/** Settles a request inside act, and waits for the `run` holding it to finish. */
async function settle(done: () => void, running: Promise<void>) {
  await act(async () => {
    done();
    await running.catch(() => {});
  });
}

afterEach(() => cleanup());

describe('useBusyIds', () => {
  it('marks an id busy while its action runs, and frees it once the action settles', async () => {
    const { busy, start } = renderBusyIds();
    const request = deferred();
    expect(busy('a')).toBe(false);

    const { running } = await start('a', () => request.promise);
    expect(busy('a')).toBe(true);
    expect(busy('b')).toBe(false);

    await settle(request.resolve, running);
    expect(busy('a')).toBe(false);
  });

  it.each([
    { order: 'the first one started settles first', first: 'a', last: 'b' },
    { order: 'the last one started settles first', first: 'b', last: 'a' },
  ] as const)('frees only its own id when $order', async ({ first, last }) => {
    const { busy, start } = renderBusyIds();
    const requests = { a: deferred(), b: deferred() };
    const running = {
      a: (await start('a', () => requests.a.promise)).running,
      b: (await start('b', () => requests.b.promise)).running,
    };
    expect(busy('a')).toBe(true);
    expect(busy('b')).toBe(true);

    await settle(requests[first].resolve, running[first]);
    expect(busy(first)).toBe(false);
    expect(busy(last)).toBe(true);

    await settle(requests[last].resolve, running[last]);
    expect(busy(first)).toBe(false);
    expect(busy(last)).toBe(false);
  });

  it('ignores a second action for an id already in flight', async () => {
    const { busy, start } = renderBusyIds();
    const request = deferred();
    const firstAction = vi.fn(() => request.promise);
    const secondAction = vi.fn(async () => {});

    const { running } = await start('a', firstAction);
    const ignored = await start('a', secondAction);
    await expect(ignored.running).resolves.toBeUndefined();
    expect(secondAction).not.toHaveBeenCalled();
    expect(busy('a')).toBe(true);

    // Only the first action's own request frees the id.
    await settle(request.resolve, running);
    expect(busy('a')).toBe(false);
    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).not.toHaveBeenCalled();
  });

  it('ignores a second action for the id even before its busy state has rendered', async () => {
    const { busy, run } = renderBusyIds();
    const request = deferred();
    const secondAction = vi.fn(async () => {});

    let running!: Promise<void>;
    // Both calls inside one act, so nothing re-renders between them.
    await act(async () => {
      running = run('a', () => request.promise);
      void run('a', secondAction);
    });
    expect(secondAction).not.toHaveBeenCalled();
    expect(busy('a')).toBe(true);

    await settle(request.resolve, running);
    expect(busy('a')).toBe(false);
  });

  it('runs an action for an id again once its previous one has settled', async () => {
    const { busy, start } = renderBusyIds();
    const first = deferred();
    await settle(first.resolve, (await start('a', () => first.promise)).running);

    const second = deferred();
    const secondAction = vi.fn(() => second.promise);
    const { running } = await start('a', secondAction);
    expect(secondAction).toHaveBeenCalledTimes(1);
    expect(busy('a')).toBe(true);

    await settle(second.resolve, running);
    expect(busy('a')).toBe(false);
  });

  it('frees the id when the action rejects, and passes the rejection on', async () => {
    const { busy, start } = renderBusyIds();
    const request = deferred();
    const error = new Error('Failed to fetch');

    const { running } = await start('a', () => request.promise);
    const outcome = running.catch((e: unknown) => e);
    await settle(() => request.reject(error), running);

    await expect(outcome).resolves.toBe(error);
    expect(busy('a')).toBe(false);
  });

  it('frees the id when the action throws before returning a promise', async () => {
    const { busy, run } = renderBusyIds();
    const error = new Error('boom');

    let running!: Promise<void>;
    await act(async () => {
      running = run('a', () => {
        throw error;
      });
      await running.catch(() => {});
    });

    await expect(running).rejects.toBe(error);
    expect(busy('a')).toBe(false);
  });

  it('says whether an id is in flight outside rendering, even before its state has rendered', async () => {
    const { running, run } = renderBusyIds();
    const request = deferred();
    expect(running('a')).toBe(false);

    let settled!: Promise<void>;
    // Read inside the same act as the call, before anything has re-rendered.
    await act(async () => {
      settled = run('a', () => request.promise);
      expect(running('a')).toBe(true);
      expect(running('b')).toBe(false);
    });

    await act(async () => {
      request.resolve();
      await settled;
      // Freed as the action settles, again before the next render.
      expect(running('a')).toBe(false);
    });
  });
});
