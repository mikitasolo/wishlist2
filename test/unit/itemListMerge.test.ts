import { describe, it, expect, vi } from 'vitest';
import {
  createMutationTracker,
  prependCreatedItem,
  updateItemOptimistically,
} from '@/lib/utils/itemListMerge';
import type { ApiItem } from '@/types/api';

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: Math.random().toString(36).slice(2),
    wishlist: 'w1',
    name: 'Item',
    status: 'available',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as ApiItem;
}

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

describe('prependCreatedItem', () => {
  it('puts a new item at the top of the list', () => {
    const a = item({ name: 'a' });
    const b = item({ name: 'b' });
    const created = item({ name: 'new' });

    expect(prependCreatedItem([a, b], created)).toEqual([created, a, b]);
  });

  it('adds to an empty list', () => {
    const created = item({ name: 'new' });
    expect(prependCreatedItem([], created)).toEqual([created]);
  });

  it('keeps a copy a poll already listed, as is', () => {
    const a = item({ name: 'a' });
    // read after the write, so at least as fresh as the create response
    const polled = item({ _id: 'new-id', status: 'available', priceInUsdCents: 1_200 });
    const created = item({ _id: 'new-id', status: 'proposed' });
    const list = [a, polled];

    expect(prependCreatedItem(list, created)).toBe(list);
  });

  it('does not mutate the list it was given', () => {
    const a = item({ name: 'a' });
    const list = [a];
    prependCreatedItem(list, item({ name: 'new' }));
    expect(list).toEqual([a]);
  });
});

// The page's `items` state as `updateItemOptimistically` sees it. React may
// run a state updater when it's queued or only at the next render, so `later`
// holds every updater until `render()` runs them, in the order they were queued.
function itemsState(items: ApiItem[], { later = false } = {}) {
  const queued: Array<(items: ApiItem[]) => ApiItem[]> = [];
  const state = {
    items,
    setItems(update: (items: ApiItem[]) => ApiItem[]) {
      if (later) queued.push(update);
      else state.items = update(state.items);
    },
    render() {
      for (const update of queued.splice(0)) state.items = update(state.items);
    },
  };
  return state;
}

describe('updateItemOptimistically', () => {
  const gift = item({ _id: 'gift', name: 'Gift', status: 'available', bookedBy: null });
  const other = item({ _id: 'other', name: 'Other' });
  const book = (i: ApiItem): ApiItem => ({ ...i, status: 'booked', bookedBy: 'me' });

  // An update of `gift` (a booking, unless `apply` says otherwise), as
  // handleUpdateItem sends one.
  function update(
    state: ReturnType<typeof itemsState>,
    request: () => Promise<ApiItem | null>,
    {
      apply = book,
      reconcile = vi.fn(),
      mutations = createMutationTracker(),
    }: {
      apply?: (item: ApiItem) => ApiItem;
      reconcile?: () => void;
      mutations?: ReturnType<typeof createMutationTracker>;
    } = {}
  ) {
    return updateItemOptimistically({
      id: gift._id,
      apply,
      request,
      setItems: state.setItems,
      mutations,
      reconcile,
    });
  }

  it('shows the change before the request is sent, and counts the request in flight', async () => {
    const state = itemsState([gift, other]);
    const mutations = createMutationTracker();
    let shownAsSent: ApiItem[] = [];
    let staleAsSent = false;
    await update(
      state,
      async () => {
        shownAsSent = state.items;
        staleAsSent = mutations.isStale(mutations.stamp());
        return book(gift);
      },
      { mutations }
    );

    expect(shownAsSent).toEqual([book(gift), other]);
    expect(staleAsSent).toBe(true);
  });

  it("merges the server's item into just that item, resolves with it, and reads nothing", async () => {
    const state = itemsState([gift, other]);
    const fromServer = { ...book(gift), priceInUsdCents: 1_200, updatedAt: '2024-02-01' };
    const reconcile = vi.fn();

    await expect(update(state, async () => fromServer, { reconcile })).resolves.toBe(fromServer);
    expect(state.items).toEqual([fromServer, other]);
    expect(state.items[1]).toBe(other);
    expect(reconcile).not.toHaveBeenCalled();
  });

  // regression: only an approve put the item back when its request failed;
  // every other update (a booking, an edit, ...) was undone by the reconcile
  // read alone. A failed read keeps the list, so when the network was down the
  // failed booking stayed on screen as "Reserved by you" until a later read got
  // through.
  it('regression: puts a failed booking back at once, even when the reconcile read fails too', async () => {
    const state = itemsState([gift, other]);
    // A failed read keeps the list as it is.
    const failedRead = vi.fn();

    await expect(update(state, async () => null, { reconcile: failedRead })).resolves.toBeNull();
    expect(state.items).toEqual([gift, other]);
    expect(failedRead).toHaveBeenCalledTimes(1);
  });

  it('reconciles a failure only once the item is back and the request has settled, so its read counts as fresh', async () => {
    const state = itemsState([gift, other]);
    const mutations = createMutationTracker();
    let shownAtReconcile: ApiItem[] = [];
    let staleAtReconcile = true;
    const reconcile = () => {
      shownAtReconcile = state.items;
      staleAtReconcile = mutations.isStale(mutations.stamp());
    };
    await update(state, async () => null, { reconcile, mutations });

    expect(shownAtReconcile).toEqual([gift, other]);
    expect(staleAtReconcile).toBe(false);
  });

  it('undoes a request that rejects too, and passes the rejection on', async () => {
    const state = itemsState([gift, other]);
    const reconcile = vi.fn();
    const error = new Error('boom');

    await expect(update(state, () => Promise.reject(error), { reconcile })).rejects.toBe(error);
    expect(state.items).toEqual([gift, other]);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('puts back only the failed item, keeping what else changed meanwhile', async () => {
    const state = itemsState([gift, other]);
    const patch = deferred<ApiItem | null>();
    const settled = update(state, () => patch.promise);

    // Another update lands while this one is in flight.
    const renamed = { ...other, name: 'Other, renamed' };
    state.setItems((items) => items.map((i) => (i._id === other._id ? renamed : i)));
    patch.resolve(null);
    await settled;

    expect(state.items).toEqual([gift, renamed]);
  });

  it("keeps another update's change to the same item, undoing only the failed one's", async () => {
    const state = itemsState([gift, other]);
    const patch = deferred<ApiItem | null>();
    const settled = update(state, () => patch.promise);

    state.setItems((items) => items.map((i) => (i._id === gift._id ? { ...i, name: 'Bike' } : i)));
    patch.resolve(null);
    await settled;

    expect(state.items).toEqual([{ ...gift, name: 'Bike' }, other]);
  });

  for (const failsFirst of ['the first', 'the second']) {
    it(`leaves the item as it was when two overlapping updates to it both fail, ${failsFirst} first`, async () => {
      const state = itemsState([gift, other]);
      const complete = deferred<ApiItem | null>();
      const rename = deferred<ApiItem | null>();
      const completing = update(state, () => complete.promise, {
        apply: (i) => ({ ...i, status: 'completed' }),
      });
      const renaming = update(state, () => rename.promise, {
        apply: (i) => ({ ...i, name: 'Bike' }),
      });
      expect(state.items[0]).toMatchObject({ status: 'completed', name: 'Bike' });

      const [first, second] = failsFirst === 'the first' ? [complete, rename] : [rename, complete];
      first.resolve(null);
      await (first === complete ? completing : renaming);
      expect(state.items[0]).not.toEqual(gift);
      second.resolve(null);
      await Promise.all([completing, renaming]);

      expect(state.items).toEqual([gift, other]);
    });
  }

  it("keeps the server's copy that a read brought in while the request was in flight", async () => {
    const state = itemsState([gift, other]);
    const patch = deferred<ApiItem | null>();
    const settled = update(state, () => patch.promise);

    // The first load, which is never dropped, lands with a co-owner's rename.
    const fromServer = { ...gift, name: 'Renamed by a co-owner' };
    state.setItems(() => [fromServer, other]);
    patch.resolve(null);
    await settled;

    expect(state.items[0]).toBe(fromServer);
  });

  it('does not bring back an item that left the list while its request was in flight', async () => {
    const state = itemsState([gift, other]);
    const patch = deferred<ApiItem | null>();
    const settled = update(state, () => patch.promise);

    // The first load, which is never dropped, lands without it.
    state.setItems(() => [other]);
    patch.resolve(null);
    await settled;

    expect(state.items).toEqual([other]);
  });

  it('puts the item back when the updaters only run at the next render', async () => {
    const state = itemsState([gift, other], { later: true });
    await update(state, async () => null);
    state.render();

    expect(state.items).toEqual([gift, other]);
  });

  it('merges the server response when the updaters only run at the next render', async () => {
    const state = itemsState([gift, other], { later: true });
    const fromServer = { ...book(gift), priceInUsdCents: 1_200 };
    await update(state, async () => fromServer);
    state.render();

    expect(state.items).toEqual([fromServer, other]);
  });
});

// The wishlist page's sequence, replayed with the helpers: `fetchItems(true)`
// drops a result `mutations.isStale` calls stale, judged by when its read was
// sent, and every item mutation runs its request through `mutations.track` (an
// update goes through `updateItemOptimistically`; an add or proposal prepends
// the server's item once its request settles). That the
// page does this on the real flows is pinned by e2e/itemPolling.authed.spec.ts.
function wishlistPage(items: ApiItem[]) {
  const { tracker: mutations, at } = trackerAt();
  const page = {
    items,
    mutations,
    at,
    // `fetchItems(true)` resolving with the list its read got.
    pollLands(sentAt: number, polled: ApiItem[]) {
      if (!mutations.isStale(sentAt)) page.items = polled;
    },
  };
  return page;
}

const ids = (items: ApiItem[]) => items.map((i) => i._id);

describe('an add or proposal racing the 5 s poll', () => {
  const existing = item({ _id: 'existing', name: 'Existing' });
  const created = item({ _id: 'created', name: 'Just added' });

  // regression: the add/propose paths prepended the new item without bumping
  // `lastMutationAt`, so a poll whose GET started before the POST settled
  // resolved afterwards with the old list and hid the item until the next poll.
  it('regression: a poll that read before the add settled does not hide the new item', async () => {
    const page = wishlistPage([existing]);

    const pollStartedAt = 1_000; // poll GET goes out, reading the old list
    const polled = [existing];

    // POST settles: prepend (as createItemHook / handleProposeItem do)
    page.at(1_050);
    const newItem = await page.mutations.track(async () => created);
    page.items = prependCreatedItem(page.items, newItem);

    // the poll resolves afterwards with the list it read before the write
    page.pollLands(pollStartedAt, polled);

    expect(ids(page.items)).toEqual(['created', 'existing']);
  });

  // regression: the POST response was prepended unconditionally, so when a poll
  // that read after the server's write had already listed the item, the same
  // `_id` showed up twice until the next poll.
  it('regression: a read that already listed the new item does not get it doubled', async () => {
    const page = wishlistPage([existing]);
    const listed = [{ ...created, priceInUsdCents: 500 }, existing];

    // the server writes the item; a poll that read after the write lands before
    // the POST response reaches the page, and is dropped as the POST is in flight
    const post = deferred<ApiItem>();
    const add = page.mutations.track(() => post.promise);
    page.pollLands(1_000, listed);
    expect(ids(page.items)).toEqual(['existing']);

    // the initial load, which is never dropped, lists it before the POST settles
    page.items = listed;

    page.at(1_050);
    post.resolve(created);
    page.items = prependCreatedItem(page.items, await add);

    expect(ids(page.items)).toEqual(['created', 'existing']);
    expect(page.items[0]).toMatchObject({ name: 'Just added', priceInUsdCents: 500 });
  });

  it('still applies a poll that started after the add settled', async () => {
    const page = wishlistPage([existing]);

    const newItem = await page.mutations.track(async () => created);
    page.items = prependCreatedItem(page.items, newItem);

    const renamed = { ...existing, name: 'Renamed by a co-owner' };
    const polled = [created, renamed];
    page.pollLands(1_100, polled);

    expect(page.items).toBe(polled);
  });
});

describe('an update racing the 5 s poll', () => {
  const gift = item({ _id: 'gift', name: 'Gift', status: 'available' });
  const booked = { ...gift, status: 'booked' as const, bookedBy: 'me' };

  // Book the gift through handleUpdateItem's path, holding the PATCH until
  // `settle`.
  function startBooking(page: ReturnType<typeof wishlistPage>) {
    const patch = deferred<ApiItem>();
    const settled = updateItemOptimistically({
      id: gift._id,
      apply: () => booked,
      request: () => patch.promise,
      setItems: (update) => {
        page.items = update(page.items);
      },
      mutations: page.mutations,
      reconcile: () => {},
    });
    return {
      async settle(at: number) {
        page.at(at);
        patch.resolve(booked);
        await settled;
      },
    };
  }

  // regression: an update stamped `lastMutationAt` when it started and again
  // when it settled, and a poll was dropped only if that stamp was later than
  // its start. A poll that started after the update did and resolved before the
  // PATCH settled was applied, so the server's copy from before the write
  // flipped the item back (a booking un-booked) until the PATCH response landed.
  it('regression: a poll that starts during an update and lands before it settles does not undo it', async () => {
    const page = wishlistPage([gift]);
    const booking = startBooking(page);

    // the poll reads the server's copy from before the write, and lands while
    // the PATCH is still in flight
    page.at(1_010);
    page.pollLands(1_010, [gift]);
    expect(page.items).toEqual([booked]);

    await booking.settle(1_050);
    expect(page.items).toEqual([booked]);
  });

  it('still drops a poll that read during the update and lands after it settled', async () => {
    const page = wishlistPage([gift]);
    const booking = startBooking(page);

    await booking.settle(1_050);
    page.pollLands(1_010, [gift]);

    expect(page.items).toEqual([booked]);
  });

  it('applies a read issued once the update settled, like the reconcile after a failure', async () => {
    const page = wishlistPage([gift]);
    const booking = startBooking(page);

    await booking.settle(1_050);
    const fromServer = [{ ...booked, name: 'Gift, renamed by a co-owner' }];
    page.pollLands(1_050, fromServer);

    expect(page.items).toBe(fromServer);
  });
});

// `fetchItems` in full, on the tracker's own clock: `read()` sends a read,
// stamped as it goes out, and `land(list)` hands it the list it got. A stale
// result is followed by a re-read once no mutation is in flight, and dropped
// if it was a background read; the first load (`read(false)`) still lands.
function pageWithReads(items: ApiItem[]) {
  const mutations = createMutationTracker();
  const page = {
    items,
    mutations,
    // Every read the page has sent, in order.
    sent: [] as Array<{ land(list: ApiItem[]): void }>,
    read(silent = true) {
      const sentAt = mutations.stamp();
      const read = {
        land(list: ApiItem[]) {
          if (mutations.isStale(sentAt)) {
            mutations.rereadWhenIdle();
            if (silent) return;
          }
          page.items = list;
        },
      };
      page.sent.push(read);
      return read;
    },
  };
  // As the page's polling sets it while it runs.
  mutations.setReread(() => page.read());
  return page;
}

describe('a read that turns out stale', () => {
  const existing = item({ _id: 'existing', name: 'Existing' });
  const created = item({ _id: 'created', name: 'Just added' });
  const gift = item({ _id: 'gift', name: 'Gift', status: 'available' });
  const booked = { ...gift, status: 'booked' as const, bookedBy: 'me' };

  it('is dropped and read again straight away once the mutation has settled', async () => {
    const page = pageWithReads([gift]);
    const poll = page.read();
    page.items = [booked];
    await page.mutations.track(async () => booked);

    poll.land([gift]);
    expect(page.items).toEqual([booked]);
    expect(page.sent).toHaveLength(2);

    page.sent[1].land([booked]);
    expect(page.items).toEqual([booked]);
  });

  // regression: only background reads were checked, so the initial load, sent
  // before an add (the "+ Add item" button shows before the items have loaded)
  // and landing after it, replaced the list without the new item, and nothing
  // read it again until the next poll.
  it('regression: the initial load that read before an add still lands, then a fresh read lists the new item', async () => {
    const page = pageWithReads([]);
    const load = page.read(false);
    page.items = prependCreatedItem(page.items, await page.mutations.track(async () => created));

    // It lands, so the list isn't just the new item, and is read again at once.
    load.land([existing]);
    expect(ids(page.items)).toEqual(['existing']);
    expect(page.sent).toHaveLength(2);

    page.sent[1].land([created, existing]);
    expect(ids(page.items)).toEqual(['created', 'existing']);
  });

  it('lands if it is the initial load and an add is still in flight, and is read again once the add settles', async () => {
    const page = pageWithReads([]);
    const load = page.read(false);
    const post = deferred<ApiItem>();
    const add = page.mutations.track(() => post.promise);

    load.land([existing]);
    expect(ids(page.items)).toEqual(['existing']);
    expect(page.sent).toHaveLength(1);

    post.resolve(created);
    page.items = prependCreatedItem(page.items, await add);
    expect(page.sent).toHaveLength(2);

    page.sent[1].land([created, existing]);
    expect(ids(page.items)).toEqual(['created', 'existing']);
  });

  // regression: after a failed update the page reconciles with a read, which
  // was dropped if another item mutation was still in flight when it landed
  // (or had settled while it was in flight) and never retried, so the failed
  // booking stayed on screen until the next poll.
  it("regression: a failed update's reconcile read dropped behind another mutation is read again once that settles", async () => {
    const page = pageWithReads([gift]);
    page.items = [booked];
    await page.mutations.track(async () => null);
    const reconcile = page.read();
    const post = deferred<ApiItem>();
    const propose = page.mutations.track(() => post.promise);

    // Dropped while the proposal is in flight, and nothing is read until it settles.
    reconcile.land([gift]);
    expect(page.items).toEqual([booked]);
    expect(page.sent).toHaveLength(1);

    post.resolve(created);
    page.items = prependCreatedItem(page.items, await propose);
    expect(page.sent).toHaveLength(2);

    page.sent[1].land([created, gift]);
    expect(page.items).toEqual([created, gift]);
  });

  it('ends in one re-read however many polls are dropped behind a slow mutation', async () => {
    const page = pageWithReads([gift]);
    page.items = [booked];
    const patch = deferred<ApiItem>();
    const booking = page.mutations.track(() => patch.promise);

    for (let i = 0; i < 5; i += 1) page.read().land([gift]);
    expect(page.items).toEqual([booked]);
    expect(page.sent).toHaveLength(5);

    patch.resolve(booked);
    await booking;
    expect(page.sent).toHaveLength(6);
  });
});
