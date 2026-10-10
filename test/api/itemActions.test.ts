import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The item actions behind PATCH / DELETE /api/items/[id], called directly
// (WIS-373). The route tests cover them through HTTP; these pin what the
// service itself guarantees to any caller: each write is made only while the
// item is still as it was read, every item answer is `serializeItem`-shaped
// for the caller's role, and an edit never changes an item's status.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(async (_from: string, to: string) => ({ url: `${HOST}/${to}` })),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { Types } from 'mongoose';
import User from '@/models/User';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item, { type IItem } from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';
import { deleteItem, updateItem } from '@/lib/utils/itemActions';
import { PROPOSAL_EDITED_ERROR, PROPOSAL_REVIEWED_ERROR } from '@/lib/utils/proposalReview';

const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');

let owner: string;
let alice: string;
let bob: string;
let wishlist: IWishlist;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  del.mockClear();
  const [o, a, b] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
  ]);
  [owner, alice, bob] = [o, a, b].map((u) => u._id.toString());
  wishlist = await Wishlist.create({ name: 'Birthday', owners: [o._id], visibility: 'everyone' });
  await WishlistMember.create([
    { wishlist: wishlist._id, user: a._id },
    { wishlist: wishlist._id, user: b._id },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ownerActor = () => ({ userId: owner, isOwner: true, isMember: false, isProposer: false });
const memberActor = (id: string) => ({
  userId: id,
  isOwner: false,
  isMember: true,
  isProposer: false,
});

async function makeItem(fields: Partial<IItem> = {}) {
  return Item.create({ wishlist: wishlist._id, name: 'Blue Mug', ...fields });
}

describe('updateItem: reserving and releasing', () => {
  it('books an available item to the member, writes their Reservation and answers with their booking', async () => {
    const item = await makeItem();
    const result = await updateItem({
      item,
      wishlist,
      actor: memberActor(alice),
      data: { status: 'booked' },
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'booked', bookedBy: alice } });
    expect((await Item.findById(item._id))?.bookedBy?.toString()).toBe(alice);
    expect(await Reservation.countDocuments({ gifter: alice, item: item._id })).toBe(1);
  });

  it('a reservation decided on a stale read loses to the booking that landed first (409, nothing written)', async () => {
    const stale = await makeItem();
    await Item.updateOne({ _id: stale._id }, { status: 'booked', bookedBy: bob });
    const result = await updateItem({
      item: stale,
      wishlist,
      actor: memberActor(alice),
      data: { status: 'booked' },
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This item is no longer available to reserve',
    });
    expect((await Item.findById(stale._id))?.bookedBy?.toString()).toBe(bob);
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
  });

  it('undoes a booking whose member was removed while it was in flight, so none is left unreleasable', async () => {
    const item = await makeItem();
    await WishlistMember.deleteOne({ wishlist: wishlist._id, user: alice });
    const result = await updateItem({
      item,
      wishlist,
      actor: memberActor(alice),
      data: { status: 'booked' },
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    const now = await Item.findById(item._id);
    expect(now?.status).toBe('available');
    expect(now?.bookedBy ?? null).toBeNull();
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
  });

  it("releases the member's own booking and its Reservation", async () => {
    const item = await makeItem();
    await updateItem({ item, wishlist, actor: memberActor(alice), data: { status: 'booked' } });
    const booked = (await Item.findById(item._id))!;
    const result = await updateItem({
      item: booked,
      wishlist,
      actor: memberActor(alice),
      data: { status: 'available' },
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'available' } });
    expect(await Reservation.countDocuments({ gifter: alice })).toBe(0);
  });
});

describe('updateItem: owners', () => {
  it('an edit never changes the status of a booked item, and the answer hides the booking', async () => {
    const item = await makeItem({ status: 'booked', bookedBy: new Types.ObjectId(alice) });
    const result = await updateItem({
      item,
      wishlist,
      actor: ownerActor(),
      data: { name: 'Red Mug', mostWanted: true },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.status).toBe('available');
    expect(result.data?.bookedBy).toBeUndefined();
    const now = await Item.findById(item._id);
    expect(now?.name).toBe('Red Mug');
    expect(now?.status).toBe('booked');
    expect(now?.bookedBy?.toString()).toBe(alice);
  });

  it('a stale publish on an item booked since is a no-op on status, but the content lands', async () => {
    const stale = await makeItem({ status: 'draft' });
    await Item.updateOne({ _id: stale._id }, { status: 'booked', bookedBy: alice });
    const result = await updateItem({
      item: stale,
      wishlist,
      actor: ownerActor(),
      data: { status: 'available', name: 'Renamed' },
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'available', name: 'Renamed' } });
    const now = await Item.findById(stale._id);
    expect(now?.status).toBe('booked');
    expect(now?.bookedBy?.toString()).toBe(alice);
  });

  it('refuses a link from a non-owner before anything is written', async () => {
    const item = await makeItem();
    const other = await makeItem({ name: 'Saucer' });
    const result = await updateItem({
      item,
      wishlist,
      actor: memberActor(alice),
      data: { linkItems: [other._id.toString()] },
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'Only owners can link items' });
  });
});

describe('updateItem: reviewing a proposal', () => {
  it('approves it under its guard, tells the proposer, and answers anonymously', async () => {
    const item = await makeItem({ status: 'proposed', proposedBy: new Types.ObjectId(alice) });
    const result = await updateItem({
      item,
      wishlist,
      actor: ownerActor(),
      data: { status: 'available', expectedStatus: 'proposed' },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.status).toBe('available');
    expect(result.data?.proposedBy).toBeUndefined();
    expect(await Notification.countDocuments({ user: alice, type: 'proposal_approved' })).toBe(1);
  });

  it('refuses an approval of a proposal approved since the read, and notifies nobody', async () => {
    const stale = await makeItem({ status: 'proposed', proposedBy: new Types.ObjectId(alice) });
    await Item.updateOne({ _id: stale._id }, { status: 'available', proposedBy: null });
    const result = await updateItem({
      item: stale,
      wishlist,
      actor: ownerActor(),
      data: { status: 'available' },
    });
    expect(result).toEqual({ ok: false, status: 409, error: PROPOSAL_REVIEWED_ERROR });
    expect(await Notification.countDocuments({ user: alice })).toBe(0);
  });

  it('refuses an approval of an edited version with the proposal as it is now, owner-shaped', async () => {
    const item = await makeItem({ status: 'proposed', proposedBy: new Types.ObjectId(alice) });
    const result = await updateItem({
      item,
      wishlist,
      actor: ownerActor(),
      data: {
        status: 'available',
        expectedStatus: 'proposed',
        expectedUpdatedAt: new Date(item.updatedAt.getTime() - 1000).toISOString(),
      },
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result).toMatchObject({ status: 409, error: PROPOSAL_EDITED_ERROR });
    expect(result.data?.name).toBe('Blue Mug');
    expect(result.data?.proposedBy).toBeUndefined();
    expect((await Item.findById(item._id))?.status).toBe('proposed');
  });
});

describe('deleteItem', () => {
  it("deletes an owner's item and frees its uploaded image", async () => {
    const imageUrl = `${HOST}/uploads/${owner}/image-abc.jpg`;
    const item = await makeItem({ imageUrl });
    const result = await deleteItem({
      item,
      wishlist,
      isOwner: true,
      userId: owner,
      expectsProposal: false,
    });
    expect(result).toEqual({ ok: true });
    expect(await Item.exists({ _id: item._id })).toBeNull();
    expect(del).toHaveBeenCalledWith(imageUrl);
  });

  it('a withdrawal that lost to an approval is a 409 and deletes nothing', async () => {
    const stale = await makeItem({ status: 'proposed', proposedBy: new Types.ObjectId(alice) });
    await Item.updateOne({ _id: stale._id }, { status: 'available', proposedBy: null });
    const result = await deleteItem({
      item: stale,
      wishlist,
      isOwner: false,
      userId: alice,
      expectsProposal: false,
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This item is no longer a proposal you can withdraw',
    });
    expect(await Item.exists({ _id: stale._id })).not.toBeNull();
  });

  it("an owner's Decline of an item that's no longer a proposal is refused", async () => {
    const item = await makeItem({ status: 'booked', bookedBy: new Types.ObjectId(alice) });
    const result = await deleteItem({
      item,
      wishlist,
      isOwner: true,
      userId: owner,
      expectsProposal: true,
    });
    expect(result).toEqual({ ok: false, status: 409, error: PROPOSAL_REVIEWED_ERROR });
    expect(await Item.exists({ _id: item._id })).not.toBeNull();
  });

  it('an item deleted since the read is a 404, for an owner too', async () => {
    const item = await makeItem();
    await Item.deleteOne({ _id: item._id });
    const result = await deleteItem({
      item,
      wishlist,
      isOwner: true,
      userId: owner,
      expectsProposal: false,
    });
    expect(result).toEqual({ ok: false, status: 404, error: 'Item not found' });
  });
});

describe('updateItem: images and prices', () => {
  it('frees the image the write replaced, the one on the item as it landed', async () => {
    const read = `${HOST}/uploads/${owner}/first.jpg`;
    const landed = `${HOST}/uploads/${owner}/second.jpg`;
    const next = `${HOST}/uploads/${owner}/third.jpg`;
    const stale = await makeItem({ imageUrl: read });
    // A co-owner's replacement since the read (which freed `read` itself).
    await Item.updateOne({ _id: stale._id }, { imageUrl: landed });
    const result = await updateItem({
      item: stale,
      wishlist,
      actor: ownerActor(),
      data: { imageUrl: next },
    });
    expect(result).toMatchObject({ ok: true, data: { imageUrl: next } });
    expect(del).toHaveBeenCalledWith(landed);
    expect(del).not.toHaveBeenCalledWith(read);
  });

  it('refuses a price in a currency with no rate, writing nothing', async () => {
    const item = await makeItem();
    const result = await updateItem({
      item,
      wishlist,
      actor: ownerActor(),
      data: { name: 'New', price: { value: 100, currency: 'XYZ' } },
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((await Item.findById(item._id))?.name).toBe('Blue Mug');
  });
});
