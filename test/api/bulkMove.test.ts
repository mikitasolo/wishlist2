import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// Moving an owner's picked items to another of their lists (WIS-434): the bulk
// route's `move`, a copy onto the target and a delete here. These pin that the
// caller must own both lists (checked up front and again once the copies are
// written) and the target can't be archived, that the source side is exactly a
// delete (gifters keep their Reservations, group gifts end, links to items
// left behind go, links among the moved items follow them), that images are
// copied and the source's freed only after, that nothing answered depends on a
// booking, and that a retried or dead request never leaves an item on both
// lists.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
const purge = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: purge }));
// A store that records what it's asked to do instead of doing it.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
const head = vi.fn();
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  head: (...a: unknown[]) => head(...a),
  list: (...a: unknown[]) => list(...a),
  put: vi.fn(),
}));

import mongoose from 'mongoose';
import { POST as bulkRoute } from '@/app/api/wishlists/[id]/items/bulk/route';
import Item from '@/models/Item';
import ItemBatch from '@/models/ItemBatch';
import Reservation from '@/models/Reservation';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { ITEM_BATCH_STALE_MS, ITEM_BATCH_KEY_REUSED_ERROR } from '@/lib/utils/bulkItemActions';
import { MOVE_TARGET_ERROR } from '@/lib/utils/bulkItems';
import { MOVE_DEADLINE_MS } from '@/lib/utils/bulkItemMove';
import { scopedIdempotencyKey } from '@/lib/utils/itemIdempotency';
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

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const EXTERNAL = 'https://images.example.com/photo.jpg';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let w: World;
let target: string; // another list the owner owns
const gifts = api(() => w);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

let copies = 0;
beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  purge.mockClear();
  copy.mockReset();
  del.mockClear();
  head.mockReset();
  list.mockReset();
  copies = 0;
  // Every copy lands at a new path, as the SDK's random suffix makes it.
  copy.mockImplementation(async (_from: string, to: string) => ({
    url: `${HOST}/${to.replace(/(\.[a-z]+)$/, `-c${++copies}$1`)}`,
  }));
  head.mockResolvedValue({ size: 1000 });
  list.mockResolvedValue({ blobs: [], cursor: undefined });
  w = await seedWorld();
  target = (
    await Wishlist.create({ name: 'Christmas', owners: [w.owner], visibility: 'everyone' })
  )._id.toString();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let keyNo = 0;
const newKey = () => `move-key-${++keyNo}-${'x'.repeat(16)}`;

function move(
  user: string | null,
  itemIds: string[],
  {
    key = newKey(),
    list = w.wishlistId,
    to = target,
  }: { key?: string; list?: string; to?: string | null } = {}
) {
  as(user);
  return bulkRoute(
    json(
      `/api/wishlists/${list}/items/bulk`,
      'POST',
      { action: 'move', itemIds, ...(to === null ? {} : { targetWishlistId: to }) },
      { 'Idempotency-Key': key }
    ),
    { params: Promise.resolve({ id: list }) }
  );
}

async function makeItem(fields: Record<string, unknown> = {}, wishlist = w.wishlistId) {
  const item = await Item.create({ wishlist, name: 'Mug', ...fields });
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

/** An unfinished batch row, dated past `ITEM_BATCH_STALE_MS`: an attempt that died. */
async function deadBatch(fields: Record<string, unknown>) {
  const row = await ItemBatch.create({
    user: w.owner,
    wishlist: w.wishlistId,
    expiresAt: new Date(Date.now() + 60_000),
    ...fields,
  });
  await ItemBatch.collection.updateOne(
    { _id: row._id },
    { $set: { createdAt: new Date(Date.now() - ITEM_BATCH_STALE_MS - 1000) } }
  );
}

const onTarget = () => Item.find({ wishlist: target }).sort({ createdAt: 1 }).lean();

describe('moving items: who may, and where to', () => {
  it('signed out is a 401, a member or an outsider a 403, and nothing moves', async () => {
    expect((await move(null, [w.itemId])).status).toBe(401);
    for (const user of [w.alice, w.dave]) {
      expect((await move(user, [w.itemId])).status).toBe(403);
    }
    expect(await Item.exists({ _id: w.itemId })).toBeTruthy();
    expect(await onTarget()).toHaveLength(0);
  });

  it('refuses every target that isn’t another unarchived list of theirs with one answer', async () => {
    const theirs = await Wishlist.create({
      name: 'Dave’s',
      owners: [w.dave],
      visibility: 'everyone',
    });
    const memberOf = await Wishlist.create({
      name: 'Shared',
      owners: [w.dave],
      visibility: 'everyone',
    });
    await WishlistMember.create({ wishlist: memberOf._id, user: w.owner });
    const archived = await Wishlist.create({
      name: 'Old',
      owners: [w.owner],
      visibility: 'everyone',
      archived: true,
    });
    const othersArchived = await Wishlist.create({
      name: 'Hidden',
      owners: [w.dave],
      visibility: 'everyone',
      archived: true,
    });
    const targets = [
      theirs._id.toString(),
      memberOf._id.toString(),
      archived._id.toString(),
      othersArchived._id.toString(),
      new mongoose.Types.ObjectId().toString(),
      w.wishlistId,
    ];
    for (const to of targets) {
      const res = await move(w.owner, [w.itemId], { to });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ success: false, error: MOVE_TARGET_ERROR });
    }
    expect(await Item.countDocuments()).toBe(1);
    expect(await Item.exists({ _id: w.itemId, wishlist: w.wishlistId })).toBeTruthy();
    // A refused target lets go of the key.
    expect(await ItemBatch.countDocuments()).toBe(0);
  });

  it('needs a target for a move, and takes none for anything else', async () => {
    expect((await move(w.owner, [w.itemId], { to: null })).status).toBe(400);
    as(w.owner);
    const res = await bulkRoute(
      json(
        `/api/wishlists/${w.wishlistId}/items/bulk`,
        'POST',
        { action: 'delete', itemIds: [w.itemId], targetWishlistId: target },
        { 'Idempotency-Key': newKey() }
      ),
      { params: Promise.resolve({ id: w.wishlistId }) }
    );
    expect(res.status).toBe(400);
    expect(await Item.exists({ _id: w.itemId })).toBeTruthy();
  });

  it('a co-owner of both lists may move, from an archived list too', async () => {
    await Wishlist.updateMany({}, { $push: { owners: w.dave } });
    await Wishlist.updateOne({ _id: w.wishlistId }, { archived: true });
    const res = await move(w.dave, [w.itemId]);
    expect(res.status).toBe(200);
    expect((await res.json()).data.done).toEqual([w.itemId]);
    expect(await onTarget()).toHaveLength(1);
  });
});

describe('moving items: what moves', () => {
  it('copies each item onto the target and deletes it here', async () => {
    const draft = await makeItem({
      name: 'Book',
      status: 'draft',
      price: { value: 1500, currency: 'eur' },
      link: 'https://shop.example.com/book',
      notes: 'Hardback',
      mostWanted: true,
      imageUrl: EXTERNAL,
    });
    const res = await move(w.owner, [w.itemId, draft]);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      done: [w.itemId, draft],
      skipped: [],
      gone: [],
      failed: [],
      items: [],
    });
    expect(await Item.countDocuments({ wishlist: w.wishlistId })).toBe(0);
    const moved = await onTarget();
    expect(moved.map((i) => [i.name, i.status])).toEqual([
      ['Camera', 'available'],
      ['Book', 'draft'],
    ]);
    expect(moved[1]).toMatchObject({
      price: { value: 1500, currency: 'EUR' },
      link: 'https://shop.example.com/book',
      notes: 'Hardback',
      mostWanted: true,
      imageUrl: EXTERNAL,
    });
    // An external image is never ours to delete.
    expect(del).not.toHaveBeenCalled();
    expect(purge).toHaveBeenCalledWith({ wishlistIds: [w.wishlistId, target] });
  });

  it('leaves an item marked as received, and a proposal, where they are', async () => {
    const received = await makeItem({ status: 'completed' });
    const proposal = await makeItem({ status: 'proposed', proposedBy: w.alice });
    const res = await move(w.owner, [received, proposal]);
    const { data } = await res.json();
    expect(data.done).toEqual([]);
    expect(data.skipped).toEqual([received, proposal]);
    expect(data.items.map((i: { _id: string }) => i._id)).toEqual([received, proposal]);
    expect(await onTarget()).toHaveLength(0);
    expect(await ItemBatch.countDocuments({ moves: { $exists: true } })).toBe(0);
  });

  it('answers an id from another list as gone, and leaves it alone', async () => {
    const other = await Wishlist.create({
      name: 'Other',
      owners: [w.dave],
      visibility: 'everyone',
    });
    const theirs = await makeItem({}, other._id.toString());
    const { data } = await (await move(w.owner, [theirs])).json();
    expect(data.gone).toEqual([theirs]);
    expect(await Item.exists({ _id: theirs, wishlist: other._id })).toBeTruthy();
    expect(await onTarget()).toHaveLength(0);
  });

  it('copies an image of ours into the caller’s uploads, and frees the source’s only after', async () => {
    const source = blobOf(w.owner);
    const id = await makeItem({ imageUrl: source });
    let copiedBeforeFree = false;
    del.mockImplementation(async () => {
      copiedBeforeFree = (await Item.countDocuments({ wishlist: target })) === 1;
    });
    const res = await move(w.owner, [id]);
    expect((await res.json()).data.done).toEqual([id]);
    const [moved] = await onTarget();
    expect(moved.imageUrl).toMatch(new RegExp(`^${HOST}/uploads/${w.owner}/image-c1\\.jpg$`));
    expect(moved.imageUrl).not.toBe(source);
    expect(del).toHaveBeenCalledWith(source);
    expect(del).not.toHaveBeenCalledWith(moved.imageUrl);
    expect(copiedBeforeFree).toBe(true);
  });

  it('leaves an item whose image can’t be copied where it is, and moves the rest', async () => {
    const stuck = await makeItem({ imageUrl: blobOf(w.owner) });
    head.mockResolvedValue({ size: 200 * 1024 * 1024 }); // over the quota
    const res = await move(w.owner, [stuck, w.itemId]);
    const { data } = await res.json();
    expect(data.failed).toEqual([stuck]);
    expect(data.done).toEqual([w.itemId]);
    expect(await Item.exists({ _id: stuck, wishlist: w.wishlistId })).toBeTruthy();
    expect((await onTarget()).map((i) => i.name)).toEqual(['Camera']);
    expect(del).not.toHaveBeenCalled();
  });

  it('moves links among the moved items, and drops those to items left behind', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const c = new mongoose.Types.ObjectId();
    await Item.create([
      { _id: a, wishlist: w.wishlistId, name: 'A', relatedItems: [b, c] },
      { _id: b, wishlist: w.wishlistId, name: 'B', relatedItems: [a] },
      { _id: c, wishlist: w.wishlistId, name: 'C', relatedItems: [a] },
    ]);
    await move(w.owner, [a.toString(), b.toString()]);
    const moved = await onTarget();
    const byName = new Map(moved.map((i) => [i.name, i]));
    expect(byName.get('A')!.relatedItems!.map(String)).toEqual([String(byName.get('B')!._id)]);
    expect(byName.get('B')!.relatedItems!.map(String)).toEqual([String(byName.get('A')!._id)]);
    expect((await Item.findById(c))!.relatedItems ?? []).toEqual([]);
  });
});

describe('moving items: owners never learn a booking', () => {
  it('moves a reserved item exactly as an available one, and its gifter keeps their Reservation', async () => {
    const free = await makeItem({ name: 'Lamp' });
    await reserveAsAlice(w.itemId);
    const res = await move(w.owner, [w.itemId, free]);
    const body = await res.text();
    expect(JSON.parse(body).data).toEqual({
      done: [w.itemId, free],
      skipped: [],
      gone: [],
      failed: [],
      items: [],
    });
    expect(body).not.toContain(w.alice);
    expect(body).not.toContain('booked');
    // The copy starts unreserved; alice keeps hers, as with a delete.
    const moved = await onTarget();
    expect(moved.every((i) => i.status === 'available' && !i.bookedBy)).toBe(true);
    expect(await Reservation.countDocuments({ gifter: w.alice, item: w.itemId })).toBe(1);
    await expectEveryBookingReleasable(w.wishlistId);
  });

  it('ends a group gift on a moved item', async () => {
    expect((await gifts.start(w.alice)).status).toBe(201);
    expect(await liveGift(w.itemId)).not.toBeNull();
    expect((await move(w.owner, [w.itemId])).status).toBe(200);
    expect(await liveGift(w.itemId)).toBeNull();
    const [moved] = await onTarget();
    expect(moved.groupGift ?? null).toBeNull();
    await expectEveryBookingReleasable(w.wishlistId);
  });
});

describe('moving items: races and retries', () => {
  it('takes the copies back when the caller stops owning the target meanwhile', async () => {
    await Wishlist.updateOne({ _id: target }, { $push: { owners: w.dave } });
    holdFirstCall(
      Item,
      'insertMany',
      () => Wishlist.updateOne({ _id: target }, { $pull: { owners: w.owner } }),
      { after: true }
    );
    const res = await move(w.owner, [w.itemId]);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(MOVE_TARGET_ERROR);
    expect(await onTarget()).toHaveLength(0);
    expect(await Item.exists({ _id: w.itemId, wishlist: w.wishlistId })).toBeTruthy();
    expect(await ItemBatch.countDocuments()).toBe(0);
  });

  it('takes the copies back when the target is archived meanwhile', async () => {
    const id = await makeItem({ imageUrl: blobOf(w.owner) });
    holdFirstCall(
      Item,
      'insertMany',
      () => Wishlist.updateOne({ _id: target }, { archived: true }),
      { after: true }
    );
    const res = await move(w.owner, [id]);
    expect(res.status).toBe(422);
    expect(await onTarget()).toHaveLength(0);
    expect(await Item.exists({ _id: id, wishlist: w.wishlistId })).toBeTruthy();
    // Its image copy is freed; the source's is untouched.
    expect(del).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalledWith(blobOf(w.owner));
    expect(del.mock.calls.every(([url]) => /image-c1\.jpg$/.test(url as string))).toBe(true);
  });

  it('takes the copies back when the caller stops owning the source meanwhile', async () => {
    await Wishlist.updateOne({ _id: w.wishlistId }, { $push: { owners: w.dave } });
    holdFirstCall(
      Item,
      'insertMany',
      () => Wishlist.updateOne({ _id: w.wishlistId }, { $pull: { owners: w.owner } }),
      { after: true }
    );
    const res = await move(w.owner, [w.itemId]);
    expect(res.status).toBe(403);
    expect(await onTarget()).toHaveLength(0);
    expect(await Item.exists({ _id: w.itemId, wishlist: w.wishlistId })).toBeTruthy();
  });

  it('takes back the copy of an item another owner deleted meanwhile', async () => {
    const other = await makeItem({ name: 'Lamp' });
    holdFirstCall(Item, 'findOneAndDelete', () => Item.deleteOne({ _id: w.itemId }));
    const res = await move(w.owner, [w.itemId, other]);
    const { data } = await res.json();
    expect(data.gone).toEqual([w.itemId]);
    expect(data.done).toEqual([other]);
    expect((await onTarget()).map((i) => i.name)).toEqual(['Lamp']);
  });

  it('stops deleting at its deadline: the rest stay here, their copies taken back', async () => {
    const lamp = await makeItem({ name: 'Lamp' });
    const realNow = Date.now.bind(Date);
    // The copies are written; by the time the deletes start, time is up.
    holdFirstCall(
      Item,
      'insertMany',
      async () => {
        vi.spyOn(Date, 'now').mockImplementation(() => realNow() + MOVE_DEADLINE_MS + 1000);
      },
      { after: true }
    );
    const { data } = await (await move(w.owner, [w.itemId, lamp])).json();
    expect(data.failed).toEqual([w.itemId, lamp]);
    expect(await onTarget()).toHaveLength(0);
    expect(await Item.countDocuments({ wishlist: w.wishlistId })).toBe(2);
  });

  it('settles what it wrote when it fails part-way, so nothing is on both lists', async () => {
    const lamp = await makeItem({ name: 'Lamp' });
    purge.mockRejectedValueOnce(new Error('purge down'));
    const res = await move(w.owner, [w.itemId, lamp]);
    expect(res.status).toBe(500);
    // Both were deleted here before the failure, so their copies stand.
    expect((await onTarget()).map((i) => i.name).sort()).toEqual(['Camera', 'Lamp']);
    expect(await Item.countDocuments({ wishlist: w.wishlistId })).toBe(0);
    expect(await ItemBatch.countDocuments()).toBe(0);
  });

  it('answers a retry with the same key as the first attempt, moving nothing twice', async () => {
    const key = newKey();
    const first = await (await move(w.owner, [w.itemId], { key })).json();
    const again = await (await move(w.owner, [w.itemId], { key })).json();
    expect(again).toEqual(first);
    expect(await onTarget()).toHaveLength(1);
    // The same key for another target is another change.
    const other = await Wishlist.create({
      name: 'Third',
      owners: [w.owner],
      visibility: 'everyone',
    });
    const reused = await move(w.owner, [w.itemId], { key, to: other._id.toString() });
    expect(reused.status).toBe(422);
    expect((await reused.json()).error).toBe(ITEM_BATCH_KEY_REUSED_ERROR);
  });

  it('settles a dead attempt before a retry, so no item ends up on both lists', async () => {
    // A first attempt that died after writing both copies and deleting one item.
    const lamp = await makeItem({ name: 'Lamp' });
    const deadCopyOfCamera = await makeItem({ name: 'Camera' }, target);
    const deadCopyOfGone = await makeItem(
      { name: 'Gone', imageUrl: blobOf(w.owner, 'g.jpg') },
      target
    );
    const key = newKey();
    const { itemBatchPayload } = await import('@/lib/utils/bulkItemActions');
    await deadBatch({
      key: scopedIdempotencyKey(w.owner, key),
      payload: itemBatchPayload(w.wishlistId, 'move', [w.itemId, lamp], target),
      moves: [
        { from: w.itemId, to: deadCopyOfCamera },
        {
          from: new mongoose.Types.ObjectId(),
          to: deadCopyOfGone,
          imageUrl: blobOf(w.owner, 'g.jpg'),
        },
      ],
      copiedUrls: [blobOf(w.owner, 'g.jpg'), blobOf(w.owner, 'orphan.jpg')],
    });
    const res = await move(w.owner, [w.itemId, lamp], { key });
    expect((await res.json()).data.done).toEqual([w.itemId, lamp]);
    // The dead copy of the camera went (its item was still here); the one whose
    // item had gone stays, with its image; the orphan image is freed.
    const names = (await onTarget()).map((i) => i.name).sort();
    expect(names).toEqual(['Camera', 'Gone', 'Lamp']);
    expect(await Item.exists({ _id: deadCopyOfCamera })).toBeNull();
    expect(del).toHaveBeenCalledWith(blobOf(w.owner, 'orphan.jpg'));
    expect(del).not.toHaveBeenCalledWith(blobOf(w.owner, 'g.jpg'));
  });

  it('settles a dead move nobody retried on the caller’s next move', async () => {
    const deadCopy = await makeItem({ name: 'Camera' }, target);
    await deadBatch({
      key: scopedIdempotencyKey(w.owner, newKey()),
      payload: 'x',
      moves: [{ from: w.itemId, to: deadCopy }],
    });
    const lamp = await makeItem({ name: 'Lamp' });
    expect((await move(w.owner, [lamp])).status).toBe(200);
    expect(await Item.exists({ _id: deadCopy })).toBeNull();
    expect(await Item.exists({ _id: w.itemId, wishlist: w.wishlistId })).toBeTruthy();
    expect(await ItemBatch.countDocuments({ done: false })).toBe(0);
  });
});
