import { describe, it, expect } from 'vitest';
import { createMutationTracker, isStalePoll, prependCreatedItem } from '@/lib/utils/itemListMerge';
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

describe('isStalePoll', () => {
  it('drops a poll whose read started before the latest mutation settled', () => {
    expect(isStalePoll(1_000, 1_001)).toBe(true);
  });

  it('keeps a poll that started after the latest mutation settled', () => {
    expect(isStalePoll(1_001, 1_000)).toBe(false);
  });

  it('keeps a poll that started in the same millisecond as the stamp', () => {
    // handleUpdateItem stamps and then issues its reconcile read after a failed
    // update, usually within the same millisecond; that read must land.
    expect(isStalePoll(1_000, 1_000)).toBe(false);
  });

  it('keeps every poll before the first mutation', () => {
    expect(isStalePoll(1_000, 0)).toBe(false);
  });
});

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

  it('keeps a poll that started once the mutation settled, the same millisecond included', async () => {
    const { tracker, at } = trackerAt();
    const request = deferred();
    const settled = tracker.track(() => request.promise);

    at(1_050);
    request.resolve();
    await settled;

    // handleUpdateItem's reconcile read after a failed update is issued as soon
    // as the tracked request resolves, usually within the same millisecond.
    expect(tracker.isStale(1_050)).toBe(false);
    expect(tracker.isStale(1_060)).toBe(false);
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

// The wishlist page's sequence, replayed with the helpers: `fetchItems(true)`
// stamps `startedAt` and drops a result `mutations.isStale` calls stale, and
// every item mutation runs its request through `mutations.track` (an update
// applies its optimistic change first, and merges the server's item once the
// request settles; an add or proposal prepends the server's item). That the
// page does this on the real flows is pinned by e2e/itemPolling.authed.spec.ts.
function wishlistPage(items: ApiItem[]) {
  const { tracker: mutations, at } = trackerAt();
  const page = {
    items,
    mutations,
    at,
    // `fetchItems(true)` resolving with the list its read got.
    pollLands(startedAt: number, polled: ApiItem[]) {
      if (!mutations.isStale(startedAt)) page.items = polled;
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

  // Apply the optimistic change and start the PATCH, as handleUpdateItem does.
  function startBooking(page: ReturnType<typeof wishlistPage>) {
    const patch = deferred<ApiItem>();
    page.items = page.items.map((i) => (i._id === gift._id ? booked : i));
    const settled = page.mutations.track(() => patch.promise);
    return {
      async settle(at: number) {
        page.at(at);
        patch.resolve(booked);
        const updated = await settled;
        page.items = page.items.map((i) => (i._id === updated._id ? { ...i, ...updated } : i));
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
