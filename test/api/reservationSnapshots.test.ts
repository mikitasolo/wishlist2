import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Booking copies an uploaded item image into a snapshot blob, so the gifter's
// reservation (and the gift log it becomes) keeps its image after the owner
// frees the item's blob. These tests pin when a snapshot is made, kept and freed.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records copies and deletions instead of performing them.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as PATCH_ITEM, DELETE as DELETE_ITEM } from '@/app/api/items/[id]/route';
import { DELETE as DISMISS } from '@/app/api/reservations/[id]/route';
import { POST as GIFT } from '@/app/api/reservations/[id]/gift/route';
import { DELETE as DELETE_GIFT } from '@/app/api/gifts/[id]/route';
import { DELETE as DELETE_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { DELETE as LEAVE } from '@/app/api/wishlists/[id]/members/me/route';
import { addWishlistOwner } from '@/lib/utils/wishlistOwnership';
import { releaseSnapshots } from '@/lib/utils/reservationSnapshots';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const EXTERNAL = 'https://images.example.com/photo.jpg';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let ownerId: string;
let gifterId: string;
let wishlistId: string;
let itemImage: string; // the owner's upload on the item

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  copy.mockReset();
  copy.mockImplementation(async (_from: string, to: string) => ({ url: `${HOST}/${to}` }));
  const owner = await User.create({ email: 'o@x.com', username: 'owner' });
  const gifter = await User.create({ email: 'g@x.com', username: 'gifter' });
  ownerId = owner._id.toString();
  gifterId = gifter._id.toString();
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [owner._id],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: gifter._id });
  itemImage = blobOf(ownerId);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

function request(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patchItem = (id: string, body: unknown) =>
  PATCH_ITEM(request(`http://localhost/api/items/${id}`, 'PATCH', body), params(id));
const deleteItem = (id: string) =>
  DELETE_ITEM(request(`http://localhost/api/items/${id}`, 'DELETE'), params(id));
const dismiss = (id: string) =>
  DISMISS(request(`http://localhost/api/reservations/${id}`, 'DELETE'), params(id));
const gift = (id: string) =>
  GIFT(request(`http://localhost/api/reservations/${id}/gift`, 'POST'), params(id));
const deleteGift = (id: string) =>
  DELETE_GIFT(request(`http://localhost/api/gifts/${id}`, 'DELETE'), params(id));
const deleteWishlist = (id: string) =>
  DELETE_WISHLIST(request(`http://localhost/api/wishlists/${id}`, 'DELETE'), params(id));
const leave = (id: string) =>
  LEAVE(request(`http://localhost/api/wishlists/${id}/members/me`, 'DELETE'), params(id));

async function makeItem(imageUrl: string | null = itemImage) {
  const item = await Item.create({ wishlist: wishlistId, name: 'Blue Mug', imageUrl });
  return item._id.toString();
}

/** Book `itemId` as the gifter and return the reservation it created. */
async function book(itemId: string) {
  as(gifterId);
  expect((await patchItem(itemId, { status: 'booked' })).status).toBe(200);
  const reservation = await Reservation.findOne({ gifter: gifterId, item: itemId });
  expect(reservation).not.toBeNull();
  return reservation!;
}

const isSnapshot = (url: string | null | undefined) =>
  !!url &&
  /^https:\/\/teststore42\.public\.blob\.vercel-storage\.com\/snapshots\/[^/]+\.jpg$/.test(url);

/** The URL of the snapshot the `n`th copy made. */
const copiedTo = (n: number) => `${HOST}/${copy.mock.calls[n][1]}`;

/** Make the next copy wait until `release()`; `called` resolves once it has started. */
function holdCopy() {
  let release = () => {};
  const called = new Promise<void>((started) => {
    copy.mockImplementationOnce(
      (_from: string, to: string) =>
        new Promise((resolve) => {
          release = () => resolve({ url: `${HOST}/${to}` });
          started();
        })
    );
  });
  return { called, release: () => release() };
}

/** The gifter's reservation image must still be there: a snapshot nobody freed. */
async function expectGifterImageIntact(snapshot: string | null | undefined) {
  const image = (await Reservation.findOne({ gifter: gifterId }))?.itemImage;
  expect(isSnapshot(image)).toBe(true);
  expect(image).toBe(snapshot);
  expect(del.mock.calls.flat()).not.toContain(image);
}

describe('booking snapshots the item image', () => {
  it('copies an uploaded image into snapshots/, and the reservation points at the copy', async () => {
    const itemId = await makeItem();
    const reservation = await book(itemId);

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).toBe(itemImage);
    expect(isSnapshot(reservation.itemImage)).toBe(true);
    // The item keeps its own image; the copy lives outside every uploads/ folder.
    expect((await Item.findById(itemId))?.imageUrl).toBe(itemImage);
    expect(reservation.itemImage).not.toContain('/uploads/');
  });

  it('stores an external image URL as-is, without copying', async () => {
    const reservation = await book(await makeItem(EXTERNAL));
    expect(copy).not.toHaveBeenCalled();
    expect(reservation.itemImage).toBe(EXTERNAL);
  });

  it('books an item without an image without copying anything', async () => {
    const reservation = await book(await makeItem(null));
    expect(copy).not.toHaveBeenCalled();
    expect(reservation.itemImage).toBeNull();
  });

  it('still books, sharing the item’s URL, when the copy fails', async () => {
    copy.mockRejectedValueOnce(new Error('The blob service is currently not available.'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const itemId = await makeItem();
      const reservation = await book(itemId);

      expect(reservation.itemImage).toBe(itemImage);
      const item = await Item.findById(itemId);
      expect(item?.status).toBe('booked');
      expect(item?.bookedBy?.toString()).toBe(gifterId);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('still books, keeping the item’s URL and freeing the copy, when attaching it fails', async () => {
    const itemId = await makeItem();
    const attach = vi
      .spyOn(Reservation, 'updateOne')
      .mockRejectedValueOnce(new Error('write failed') as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reservation = await book(itemId);

      expect(reservation.itemImage).toBe(itemImage);
      expect(del.mock.calls).toEqual([[copiedTo(0)]]);
    } finally {
      attach.mockRestore();
      errorLog.mockRestore();
    }
  });

  // The copy runs after the reservation is written, so a request that lands
  // while it's in flight still finds the reservation. Copying first would leave
  // a reservation behind for an item that's no longer booked.
  it('an unbook while the copy is in flight still deletes the reservation', async () => {
    const itemId = await makeItem();
    const held = holdCopy();
    as(gifterId);
    const booking = patchItem(itemId, { status: 'booked' });
    await held.called;

    expect((await patchItem(itemId, { status: 'available' })).status).toBe(200);
    held.release();
    expect((await booking).status).toBe(200);

    expect(await Reservation.countDocuments()).toBe(0);
    expect((await Item.findById(itemId))?.status).toBe('available');
    expect(del.mock.calls).toEqual([[copiedTo(0)]]); // the copy nobody holds
  });

  it('becoming an owner while the copy is in flight still deletes the reservation', async () => {
    const itemId = await makeItem();
    const held = holdCopy();
    as(gifterId);
    const booking = patchItem(itemId, { status: 'booked' });
    await held.called;

    const wishlist = await Wishlist.findById(wishlistId).lean();
    expect((await addWishlistOwner(wishlist!, gifterId))?.cancelledReservations).toBe(1);
    held.release();
    expect((await booking).status).toBe(200);

    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[copiedTo(0)]]);
  });

  it('a rebooking takes a fresh snapshot and frees the one it replaces', async () => {
    const itemId = await makeItem();
    const first = (await book(itemId)).itemImage;

    // The owner completes the item and reopens it: the reservation (and its
    // snapshot) survives both, so the gifter can book it again.
    as(ownerId);
    expect((await patchItem(itemId, { status: 'completed' })).status).toBe(200);
    expect((await patchItem(itemId, { status: 'available' })).status).toBe(200);
    expect(del).not.toHaveBeenCalled();

    const second = (await book(itemId)).itemImage;
    expect(isSnapshot(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(del.mock.calls).toEqual([[first]]);
    expect(await Reservation.countDocuments({ gifter: gifterId })).toBe(1);
  });
});

describe('the owner freeing the item’s image leaves the gifter’s snapshot alone', () => {
  // regression: Reservation.itemImage stored the item's own blob URL, so the
  // owner deleting the item freed that blob and broke the gifter's image.
  it('regression: deleting a booked item frees only the item’s blob', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    as(ownerId);
    const res = await deleteItem(itemId);
    // The owner's reply is the same as for an item nobody booked.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: {} });

    expect(del.mock.calls).toEqual([[itemImage]]);
    await expectGifterImageIntact(snapshot);
  });

  // regression: same cause, via the owner replacing the item's image.
  it('regression: replacing a booked item’s image frees only the old item blob', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    as(ownerId);
    const replacement = blobOf(ownerId, 'image-new.jpg');
    expect((await patchItem(itemId, { imageUrl: replacement })).status).toBe(200);

    expect(del.mock.calls).toEqual([[itemImage]]);
    await expectGifterImageIntact(snapshot);
  });

  it('deleting the whole wishlist frees the item blobs and keeps the snapshot', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    as(ownerId);
    expect((await deleteWishlist(wishlistId)).status).toBe(200);

    expect(del.mock.calls).toEqual([[itemImage]]);
    await expectGifterImageIntact(snapshot);
  });
});

describe('a reservation that ends without a gift frees its snapshot', () => {
  it('unbooking frees the snapshot, never the item’s blob', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    expect((await patchItem(itemId, { status: 'available' })).status).toBe(200);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[snapshot]]);
  });

  it('dismissing frees the snapshot', async () => {
    const reservation = await book(await makeItem());

    expect((await dismiss(reservation._id.toString())).status).toBe(200);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[reservation.itemImage]]);
  });

  it('someone else dismissing it frees nothing', async () => {
    const reservation = await book(await makeItem());

    as(ownerId);
    expect((await dismiss(reservation._id.toString())).status).toBe(404);
    expect(await Reservation.countDocuments()).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('becoming an owner deletes the reservation and frees its snapshot', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    const wishlist = await Wishlist.findById(wishlistId).lean();
    const released = await addWishlistOwner(wishlist!, gifterId);

    expect(released?.cancelledReservations).toBe(1);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[snapshot]]);
    expect((await Item.findById(itemId))?.imageUrl).toBe(itemImage);
  });

  // Reservations made before snapshots (or whose copy failed) share the item's
  // blob. Ending one must not free it: that would break the owner's image and
  // tell them the item had been booked.
  it('never frees the item’s blob held by an older reservation', async () => {
    copy.mockRejectedValue(new Error('down'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = await makeItem();
      const second = await makeItem();
      const third = await makeItem();
      const dismissed = await book(first);
      await book(second);
      await book(third);
      expect(dismissed.itemImage).toBe(itemImage);

      expect((await dismiss(dismissed._id.toString())).status).toBe(200);
      expect((await patchItem(second, { status: 'available' })).status).toBe(200);
      const wishlist = await Wishlist.findById(wishlistId).lean();
      await addWishlistOwner(wishlist!, gifterId);

      expect(await Reservation.countDocuments()).toBe(0);
      expect(del).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('paths that keep the reservation keep the snapshot', () => {
  it('leaving the list keeps the reservation and its snapshot', async () => {
    const itemId = await makeItem();
    const snapshot = (await book(itemId)).itemImage;

    expect((await leave(wishlistId)).status).toBe(200);

    expect((await Reservation.findOne({ gifter: gifterId }))?.itemImage).toBe(snapshot);
    expect(del).not.toHaveBeenCalled();
  });

  it('marking the gift hands the snapshot to the GiftLog and frees nothing', async () => {
    const reservation = await book(await makeItem());

    expect((await gift(reservation._id.toString())).status).toBe(201);

    expect(await Reservation.countDocuments()).toBe(0);
    expect((await GiftLog.findOne({ gifter: gifterId }))?.itemImage).toBe(reservation.itemImage);
    expect(del).not.toHaveBeenCalled();
  });

  it('a double-submitted gift logs one entry and keeps its snapshot', async () => {
    const reservation = await book(await makeItem());
    const id = reservation._id.toString();

    const statuses = (await Promise.all([gift(id), gift(id)])).map((r) => r.status);

    expect(statuses.sort()).toEqual([201, 404]);
    expect(await GiftLog.countDocuments()).toBe(1);
    expect((await GiftLog.findOne())?.itemImage).toBe(reservation.itemImage);
    expect(del).not.toHaveBeenCalled();
  });

  it('a gift and a dismiss of the same reservation: exactly one wins', async () => {
    const reservation = await book(await makeItem());
    const id = reservation._id.toString();

    const [gifted, dismissed] = await Promise.all([gift(id), dismiss(id)]);

    expect(await Reservation.countDocuments()).toBe(0);
    const entries = await GiftLog.find().lean();
    if (gifted.status === 201) {
      // The gift log took the snapshot over; nothing may free it.
      expect(entries.map((e) => e.itemImage)).toEqual([reservation.itemImage]);
      expect(del).not.toHaveBeenCalled();
    } else {
      expect(gifted.status).toBe(404);
      expect(dismissed.status).toBe(200);
      expect(entries).toEqual([]);
      expect(del.mock.calls).toEqual([[reservation.itemImage]]);
    }
  });

  it('marking the gift while the copy is in flight logs the item’s URL and frees the copy', async () => {
    const itemId = await makeItem();
    const held = holdCopy();
    as(gifterId);
    const booking = patchItem(itemId, { status: 'booked' });
    await held.called;
    const reservation = await Reservation.findOne({ gifter: gifterId });

    expect((await gift(reservation!._id.toString())).status).toBe(201);
    held.release();
    expect((await booking).status).toBe(200);

    expect((await GiftLog.findOne())?.itemImage).toBe(itemImage);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[copiedTo(0)]]);
  });

  it('a gift that fails to log puts the reservation back as it was', async () => {
    const reservation = await book(await makeItem());
    const write = vi.spyOn(GiftLog, 'create').mockRejectedValueOnce(new Error('write failed'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await gift(reservation._id.toString())).status).toBe(500);
    } finally {
      write.mockRestore();
      errorLog.mockRestore();
    }

    const restored = await Reservation.findById(reservation._id).lean();
    expect(restored?.itemImage).toBe(reservation.itemImage);
    expect(restored?.itemName).toBe('Blue Mug');
    expect(await GiftLog.countDocuments()).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it('deleting the gift entry frees its snapshot once no other entry shows it', async () => {
    const reservation = await book(await makeItem());
    const snapshot = reservation.itemImage;
    await gift(reservation._id.toString());
    const entry = await GiftLog.findOne({ gifter: gifterId }).lean();
    // A second entry showing the same snapshot, as double-submitted gifts could
    // write before the gift route claimed its reservation atomically.
    const { _id: _dropped, ...rest } = entry!;
    const duplicate = await GiftLog.create(rest);

    expect((await deleteGift(duplicate._id.toString())).status).toBe(200);
    expect(del).not.toHaveBeenCalled();

    expect((await deleteGift(entry!._id.toString())).status).toBe(200);
    expect(del.mock.calls).toEqual([[snapshot]]);
  });
});

describe('releaseSnapshots', () => {
  it('keeps the blob, without throwing, when it can’t check what still holds it', async () => {
    const snapshot = `${HOST}/snapshots/abc.jpg`;
    const check = vi.spyOn(GiftLog, 'exists').mockRejectedValueOnce(new Error('db down'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(releaseSnapshots(gifterId, [snapshot])).resolves.toBeUndefined();
      expect(del).not.toHaveBeenCalled();
    } finally {
      check.mockRestore();
      errorLog.mockRestore();
    }
  });

  it('frees only snapshot blobs, once each', async () => {
    const snapshot = `${HOST}/snapshots/abc.jpg`;
    await releaseSnapshots(gifterId, [snapshot, snapshot, itemImage, EXTERNAL, null]);
    expect(del.mock.calls).toEqual([[snapshot]]);
  });
});
