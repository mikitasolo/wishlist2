import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// POST /api/wishlists/[id]/items/bulk (WIS-386): an owner's action on several
// items in one request, each held to the rules (and side effects) of its own
// PATCH / DELETE, answered without a word about bookings, and made once per
// Idempotency-Key.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
const purge = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: purge }));

import mongoose from 'mongoose';
import { POST as bulkRoute } from '@/app/api/wishlists/[id]/items/bulk/route';
import Item from '@/models/Item';
import ItemBatch from '@/models/ItemBatch';
import Reservation from '@/models/Reservation';
import Wishlist from '@/models/Wishlist';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import { ITEM_BATCH_STALE_MS, ITEM_BATCH_KEY_REUSED_ERROR } from '@/lib/utils/bulkItemActions';
import { BULK_ITEMS_MAX } from '@/lib/utils/bulkItems';
import {
  api,
  as,
  expectEveryBookingReleasable,
  json,
  liveGift,
  seedWorld,
  session,
  type World,
} from './groupGiftHarness';

let w: World;
const gifts = api(() => w);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  purge.mockClear();
  w = await seedWorld();
});

let keyNo = 0;
const newKey = () => `bulk-key-${++keyNo}-${'x'.repeat(16)}`;

function bulk(
  user: string | null,
  body: unknown,
  { key = newKey(), list = w.wishlistId }: { key?: string | null; list?: string } = {}
) {
  as(user);
  return bulkRoute(
    json(
      `/api/wishlists/${list}/items/bulk`,
      'POST',
      body,
      key === null ? undefined : { 'Idempotency-Key': key }
    ),
    { params: Promise.resolve({ id: list }) }
  );
}

async function makeItem(fields: Record<string, unknown> = {}) {
  const item = await Item.create({ wishlist: w.wishlistId, name: 'Mug', ...fields });
  return item._id.toString();
}

/** alice reserves `id` through the item route, so her Reservation is written too. */
async function reserveAsAlice(id: string) {
  as(w.alice);
  const { PATCH } = await import('@/app/api/items/[id]/route');
  const res = await PATCH(json(`/api/items/${id}`, 'PATCH', { status: 'booked' }), {
    params: Promise.resolve({ id }),
  });
  expect(res.status).toBe(200);
}

describe('bulk item actions: who may', () => {
  it('signed out is a 401', async () => {
    const res = await bulk(null, { action: 'publish', itemIds: [w.itemId] });
    expect(res.status).toBe(401);
  });

  it('a member or an outsider is refused (403) and nothing changes', async () => {
    const draft = await makeItem({ status: 'draft' });
    for (const user of [w.alice, w.dave]) {
      const res = await bulk(user, { action: 'delete', itemIds: [draft, w.itemId] });
      expect(res.status).toBe(403);
    }
    expect(await Item.countDocuments({ wishlist: w.wishlistId })).toBe(2);
    expect(await ItemBatch.countDocuments()).toBe(0);
  });

  it('an archived list is the missing list’s 404 to a member, and still its owners’ to change', async () => {
    await Wishlist.updateOne({ _id: w.wishlistId }, { archived: true });
    const draft = await makeItem({ status: 'draft' });
    const refused = await bulk(w.alice, { action: 'publish', itemIds: [draft] });
    expect(refused.status).toBe(404);
    expect((await refused.json()).error).toBe('Wishlist not found');

    const res = await bulk(w.owner, { action: 'publish', itemIds: [draft] });
    expect(res.status).toBe(200);
    expect((await Item.findById(draft))?.status).toBe('available');
  });

  it('a co-owner may, as any owner', async () => {
    await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.dave } });
    const draft = await makeItem({ status: 'draft' });
    const res = await bulk(w.dave, { action: 'publish', itemIds: [draft] });
    expect(res.status).toBe(200);
    expect((await Item.findById(draft))?.status).toBe('available');
  });

  it('an item from another list is answered as gone, and left alone', async () => {
    const other = await Wishlist.create({
      name: 'Other',
      owners: [w.dave],
      visibility: 'everyone',
    });
    const theirs = await Item.create({ wishlist: other._id, name: 'Theirs' });
    const res = await bulk(w.owner, { action: 'delete', itemIds: [theirs._id.toString()] });
    expect((await res.json()).data).toMatchObject({ done: [], gone: [theirs._id.toString()] });
    expect(await Item.exists({ _id: theirs._id })).toBeTruthy();
  });

  it('refuses a missing key, no ids, too many ids and an unknown action', async () => {
    expect(
      (await bulk(w.owner, { action: 'publish', itemIds: [w.itemId] }, { key: null })).status
    ).toBe(400);
    expect((await bulk(w.owner, { action: 'publish', itemIds: [] })).status).toBe(400);
    const many = Array.from({ length: BULK_ITEMS_MAX + 1 }, () =>
      new mongoose.Types.ObjectId().toString()
    );
    expect((await bulk(w.owner, { action: 'publish', itemIds: many })).status).toBe(400);
    expect((await bulk(w.owner, { action: 'reserve', itemIds: [w.itemId] })).status).toBe(400);
  });
});

describe('bulk item actions: each item as its own change', () => {
  it('publishes drafts only; a live, received or proposed item is skipped and answered as it is', async () => {
    const d1 = await makeItem({ status: 'draft' });
    const d2 = await makeItem({ status: 'draft' });
    const done = await makeItem({ status: 'completed' });
    const proposal = await makeItem({ status: 'proposed', proposedBy: w.alice });
    const res = await bulk(w.owner, { action: 'publish', itemIds: [d1, d2, done, proposal] });
    const { data } = await res.json();
    expect(data.done).toEqual([d1, d2]);
    expect(data.skipped).toEqual([done, proposal]);
    expect(data.items.map((i: { _id: string; status: string }) => [i._id, i.status])).toEqual([
      [d1, 'available'],
      [d2, 'available'],
      [done, 'completed'],
      [proposal, 'proposed'],
    ]);
    expect((await Item.findById(done))?.status).toBe('completed');
    // Never an approval: the proposal stays one, and nobody is told anything.
    expect((await Item.findById(proposal))?.status).toBe('proposed');
    expect(data.items.find((i: { _id: string }) => i._id === proposal).proposedBy).toBeUndefined();
  });

  it('a booked item is moved to draft like any live one; the answer never shows the booking, the gifter keeps their Reservation', async () => {
    await reserveAsAlice(w.itemId);
    const plain = await makeItem();
    const res = await bulk(w.owner, { action: 'draft', itemIds: [w.itemId, plain] });
    const { data } = await res.json();
    expect(data).toMatchObject({ done: [w.itemId, plain], skipped: [], gone: [], failed: [] });
    for (const item of data.items) {
      expect(item.status).toBe('draft');
      expect(item.bookedBy).toBeUndefined();
    }
    expect(JSON.stringify(data)).not.toContain(w.alice);
    const now = await Item.findById(w.itemId);
    expect(now?.status).toBe('draft');
    expect(now?.bookedBy).toBeNull();
    expect(await Reservation.countDocuments({ gifter: w.alice, item: w.itemId })).toBe(1);
  });

  it('a booked and an unbooked item get the same answer when marked as received', async () => {
    await reserveAsAlice(w.itemId);
    const plain = await makeItem({ price: { value: 10000, currency: 'USD' } });
    const { data } = await (
      await bulk(w.owner, { action: 'received', itemIds: [w.itemId, plain] })
    ).json();
    const [a, b] = data.items;
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it('marking as received ends a live group gift, as a single one does', async () => {
    expect((await gifts.start(w.alice)).status).toBe(201);
    await bulk(w.owner, { action: 'received', itemIds: [w.itemId] });
    expect(await liveGift(w.itemId)).toBeNull();
    await expectEveryBookingReleasable(w.wishlistId);
  });

  it('marks and unmarks most wanted without touching status, and purges no share card', async () => {
    const draft = await makeItem({ status: 'draft' });
    await bulk(w.owner, { action: 'mostWanted', itemIds: [w.itemId, draft] });
    expect((await Item.findById(w.itemId))?.mostWanted).toBe(true);
    expect((await Item.findById(draft))?.status).toBe('draft');
    await bulk(w.owner, { action: 'notMostWanted', itemIds: [w.itemId] });
    expect((await Item.findById(w.itemId))?.mostWanted).toBe(false);
    expect(purge).not.toHaveBeenCalled();
  });

  it('purges the list’s share card once for a batch of status changes', async () => {
    const ids = [await makeItem({ status: 'draft' }), await makeItem({ status: 'draft' })];
    await bulk(w.owner, { action: 'publish', itemIds: ids });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith({ wishlistIds: [w.wishlistId] });
  });
});

describe('bulk delete', () => {
  it('deletes as a single delete does: group gift ended, partners unlinked, Reservations kept', async () => {
    await reserveAsAlice(w.itemId);
    const giftItem = await makeItem({ price: { value: 5000, currency: 'USD' } });
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await Item.create([
      { _id: a, wishlist: w.wishlistId, name: 'Left', relatedItems: [b] },
      { _id: b, wishlist: w.wishlistId, name: 'Right', relatedItems: [a] },
    ]);
    // bob starts a group gift on the other item.
    const giftApi = api(() => ({ ...w, itemId: giftItem }));
    expect((await giftApi.start(w.bob)).status).toBe(201);

    const res = await bulk(w.owner, {
      action: 'delete',
      itemIds: [w.itemId, giftItem, a.toString()],
    });
    const { data } = await res.json();
    expect(data).toMatchObject({
      done: [w.itemId, giftItem, a.toString()],
      skipped: [],
      gone: [],
      failed: [],
      items: [],
    });
    expect(await Item.countDocuments({ _id: { $in: [w.itemId, giftItem, a] } })).toBe(0);
    expect(await liveGift(giftItem)).toBeNull();
    expect((await Item.findById(b))?.relatedItems ?? []).toHaveLength(0);
    // Gifting is decoupled from the live item: each gifter keeps theirs.
    expect(await Reservation.countDocuments({ gifter: w.alice, item: w.itemId })).toBe(1);
    expect(await Reservation.countDocuments({ gifter: w.bob, item: giftItem })).toBe(1);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('never deletes a proposal (that is a Decline), and answers it as it is', async () => {
    const proposal = await makeItem({ status: 'proposed', proposedBy: w.alice });
    const { data } = await (await bulk(w.owner, { action: 'delete', itemIds: [proposal] })).json();
    expect(data.skipped).toEqual([proposal]);
    expect(await Item.exists({ _id: proposal })).toBeTruthy();
  });

  it('an item deleted already is answered as gone, and the rest go ahead', async () => {
    const gone = new mongoose.Types.ObjectId().toString();
    const { data } = await (
      await bulk(w.owner, { action: 'delete', itemIds: [gone, w.itemId] })
    ).json();
    expect(data).toMatchObject({ done: [w.itemId], gone: [gone] });
  });
});

describe('bulk item actions: one batch per Idempotency-Key', () => {
  it('a retry with the same key is answered as the first attempt, and applies nothing again', async () => {
    const draft = await makeItem({ status: 'draft' });
    const key = newKey();
    const first = await (
      await bulk(w.owner, { action: 'publish', itemIds: [draft] }, { key })
    ).json();
    // A co-owner moves it back to draft in between: the retry mustn't publish it again.
    await Item.updateOne({ _id: draft }, { status: 'draft' });
    const again = await bulk(w.owner, { action: 'publish', itemIds: [draft] }, { key });
    expect(again.status).toBe(200);
    const replay = (await again.json()).data;
    expect(replay.done).toEqual(first.data.done);
    expect((await Item.findById(draft))?.status).toBe('draft');
    expect(replay.items[0].status).toBe('draft');
  });

  it('a retried delete is answered as done, not as gone', async () => {
    const key = newKey();
    await bulk(w.owner, { action: 'delete', itemIds: [w.itemId] }, { key });
    const { data } = await (
      await bulk(w.owner, { action: 'delete', itemIds: [w.itemId] }, { key })
    ).json();
    expect(data).toMatchObject({ done: [w.itemId], gone: [] });
  });

  it('a key sent again with another change is refused (422), and nothing is applied', async () => {
    const key = newKey();
    const draft = await makeItem({ status: 'draft' });
    await bulk(w.owner, { action: 'mostWanted', itemIds: [draft] }, { key });
    const res = await bulk(w.owner, { action: 'delete', itemIds: [draft] }, { key });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(ITEM_BATCH_KEY_REUSED_ERROR);
    expect(await Item.exists({ _id: draft })).toBeTruthy();
  });

  it('the same key from another account is its own batch', async () => {
    await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.dave } });
    const key = newKey();
    const draft = await makeItem({ status: 'draft' });
    await bulk(w.owner, { action: 'mostWanted', itemIds: [draft] }, { key });
    const res = await bulk(w.dave, { action: 'publish', itemIds: [draft] }, { key });
    expect(res.status).toBe(200);
    expect((await Item.findById(draft))?.status).toBe('available');
  });

  it('a retry while the first attempt is still running is told to wait (409); one that died is applied again', async () => {
    const key = newKey();
    const draft = await makeItem({ status: 'draft' });
    const { scopedIdempotencyKey } = await import('@/lib/utils/itemIdempotency');
    const { itemBatchPayload } = await import('@/lib/utils/bulkItemActions');
    const row = await ItemBatch.create({
      user: w.owner,
      key: scopedIdempotencyKey(w.owner, key),
      wishlist: w.wishlistId,
      payload: itemBatchPayload(w.wishlistId, 'publish', [draft]),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const running = await bulk(w.owner, { action: 'publish', itemIds: [draft] }, { key });
    expect(running.status).toBe(409);
    expect((await Item.findById(draft))?.status).toBe('draft');

    await ItemBatch.collection.updateOne(
      { _id: row._id },
      { $set: { createdAt: new Date(Date.now() - ITEM_BATCH_STALE_MS - 1000) } }
    );
    const retried = await bulk(w.owner, { action: 'publish', itemIds: [draft] }, { key });
    expect(retried.status).toBe(200);
    expect((await Item.findById(draft))?.status).toBe('available');
  });

  it('deleting the account deletes its batches, and nobody else’s', async () => {
    await bulk(w.owner, { action: 'mostWanted', itemIds: [w.itemId] });
    await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.dave } });
    await bulk(w.dave, { action: 'notMostWanted', itemIds: [w.itemId] });
    expect(await deleteAccount(w.owner, { agreedListIds: [w.wishlistId] })).toBe('deleted');
    expect(await ItemBatch.countDocuments({ user: w.owner })).toBe(0);
    expect(await ItemBatch.countDocuments({ user: w.dave })).toBe(1);
  });
});
