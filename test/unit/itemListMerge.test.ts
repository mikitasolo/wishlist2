import { describe, it, expect } from 'vitest';
import { isStalePoll, prependCreatedItem } from '@/lib/utils/itemListMerge';
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
// stamps `startedAt` and drops a stale result, and an add or proposal stamps
// `lastMutationAt` and prepends the server's item when its POST settles. That
// the page does both on the real flows is pinned by e2e/itemPolling.authed.spec.ts.
describe('an add or proposal racing the 5 s poll', () => {
  const existing = item({ _id: 'existing', name: 'Existing' });
  const created = item({ _id: 'created', name: 'Just added' });

  // regression: the add/propose paths prepended the new item without bumping
  // `lastMutationAt`, so a poll whose GET started before the POST settled
  // resolved afterwards with the old list and hid the item until the next poll.
  it('regression: a poll that read before the add settled does not hide the new item', () => {
    let items = [existing];
    let lastMutationAt = 0;

    const pollStartedAt = 1_000; // poll GET goes out, reading the old list
    const polled = [existing];

    // POST settles: stamp, then prepend (as createItemHook / handleProposeItem do)
    lastMutationAt = 1_050;
    items = prependCreatedItem(items, created);

    // the poll resolves afterwards with the list it read before the write
    if (!isStalePoll(pollStartedAt, lastMutationAt)) items = polled;

    expect(items.map((i) => i._id)).toEqual(['created', 'existing']);
  });

  // regression: the POST response was prepended unconditionally, so when a poll
  // that read after the server's write had already listed the item, the same
  // `_id` showed up twice until the next poll.
  it('regression: a poll that already listed the new item does not get it doubled', () => {
    let items = [existing];
    let lastMutationAt = 0;

    // the server writes the item; a poll that reads after the write resolves
    // before the POST response reaches the page
    const pollStartedAt = 1_000;
    const polled = [{ ...created, priceInUsdCents: 500 }, existing];
    if (!isStalePoll(pollStartedAt, lastMutationAt)) items = polled;

    // then the POST settles
    lastMutationAt = 1_050;
    items = prependCreatedItem(items, created);

    expect(items.map((i) => i._id)).toEqual(['created', 'existing']);
    expect(items[0]).toMatchObject({ name: 'Just added', priceInUsdCents: 500 });
  });

  it('still applies a poll that started after the add settled', () => {
    let items = [existing];

    const lastMutationAt = 1_000;
    items = prependCreatedItem(items, created);

    const renamed = { ...existing, name: 'Renamed by a co-owner' };
    const polled = [created, renamed];
    if (!isStalePoll(1_100, lastMutationAt)) items = polled;

    expect(items).toBe(polled);
  });
});
