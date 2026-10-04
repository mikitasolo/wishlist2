import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// Deleting a list deletes its items and frees their images (WIS-206). An item
// request that read the list before it was deleted can still write after it, so
// the images freed are the ones the items held when they were deleted, never
// ones read before: each image is freed exactly once, including one an edit put
// in place meanwhile, and an item created meanwhile goes too.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records deletions instead of performing them.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn().mockResolvedValue({ blobs: [], cursor: undefined }),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { DELETE as DELETE_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';

const session = vi.mocked(auth);

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const blobOf = (userId: string, name: string) => `${HOST}/uploads/${userId}/${name}`;
const EXTERNAL = 'https://images.example.com/photo.jpg';

let alice: string;
let bob: string;
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  const [a, b] = await User.create([
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
  ]);
  [alice, bob] = [a, b].map((u) => u._id.toString());
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [a._id, b._id],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function request(user: string, path: string, method: string, body?: unknown) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const deleteList = (user: string) =>
  DELETE_WISHLIST(request(user, `/api/wishlists/${wishlistId}`, 'DELETE'), {
    params: Promise.resolve({ id: wishlistId }),
  });

const patchItem = (user: string, itemId: string, body: unknown) =>
  PATCH_ITEM(request(user, `/api/items/${itemId}`, 'PATCH', body), {
    params: Promise.resolve({ id: itemId }),
  });

const freed = () => del.mock.calls.map(([url]) => url as string).sort();

describe('DELETE /api/wishlists/[id] — the items and their images', () => {
  it('deletes every item and frees each uploaded image once, never an external one', async () => {
    // More items than one batch, so the cleanup has to read them again.
    const images = Array.from({ length: 120 }, (_, i) => blobOf(alice, `item-${i}.jpg`));
    await Item.create([
      ...images.map((imageUrl, i) => ({ wishlist: wishlistId, name: `Item ${i}`, imageUrl })),
      { wishlist: wishlistId, name: 'External', imageUrl: EXTERNAL },
      { wishlist: wishlistId, name: 'No image' },
    ]);

    expect((await deleteList(alice)).status).toBe(200);

    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(freed()).toEqual([...images].sort());
  });

  it("leaves another list's items and images alone", async () => {
    const other = await Wishlist.create({ name: 'Other', owners: [alice], visibility: 'everyone' });
    const kept = blobOf(alice, 'kept.jpg');
    await Item.create({ wishlist: other._id, name: 'Kept', imageUrl: kept });
    const gone = blobOf(alice, 'gone.jpg');
    await Item.create({ wishlist: wishlistId, name: 'Gone', imageUrl: gone });

    expect((await deleteList(alice)).status).toBe(200);

    expect(await Item.countDocuments({ wishlist: other._id })).toBe(1);
    expect(freed()).toEqual([gone]);
  });

  it("regression: an edit replacing an item's image just before the cleanup deletes it frees each image once", async () => {
    // regression: the cleanup read the items' images, then deleteMany'd the
    // items and freed what it had read. An edit that replaced A with C in
    // between freed A, the cleanup freed A again, and C was never freed.
    const original = blobOf(alice, 'original.jpg');
    const replacement = blobOf(bob, 'replacement.jpg');
    const itemId = (
      await Item.create({ wishlist: wishlistId, name: 'Blue Mug', imageUrl: original })
    )._id.toString();

    // Bob's edit gets past its reads and checks (the list still exists) and is
    // held at its write.
    const realUpdate = Item.findOneAndUpdate.bind(Item);
    let reachedWrite!: () => void;
    const editAtWrite = new Promise<void>((resolve) => (reachedWrite = resolve));
    let letWrite!: () => void;
    const writeMayLand = new Promise<void>((resolve) => (letWrite = resolve));
    vi.spyOn(Item, 'findOneAndUpdate').mockImplementation(((...args: unknown[]) => {
      reachedWrite();
      return writeMayLand.then(() => (realUpdate as (...a: unknown[]) => unknown)(...args));
    }) as never);
    const edit = patchItem(bob, itemId, { imageUrl: replacement });
    await editAtWrite;

    // Alice deletes the list; its cleanup has found the item, and the edit's
    // write lands just before the cleanup deletes it.
    const race = holdFirstCall(Item, 'findOneAndDelete', async () => {
      letWrite();
      await edit;
    });
    expect((await deleteList(alice)).status).toBe(200);
    expect(race.held()).toBe(true);

    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(0);
    // The edit freed the original (its write replaced it), the cleanup freed
    // the replacement (its delete took it), and neither twice.
    expect(freed()).toEqual([original, replacement].sort());
  });

  it('regression: an item created just before the cleanup deletes the items goes too, with its image', async () => {
    // regression: the cleanup's deleteMany took an item created after its read
    // without freeing its image.
    const first = blobOf(alice, 'first.jpg');
    const late = blobOf(bob, 'late.jpg');
    await Item.create({ wishlist: wishlistId, name: 'First', imageUrl: first });

    // A create that read the list before it was deleted writes its item now.
    const race = holdFirstCall(Item, 'findOneAndDelete', () =>
      Item.create({ wishlist: wishlistId, name: 'Late', imageUrl: late })
    );
    expect((await deleteList(alice)).status).toBe(200);
    expect(race.held()).toBe(true);

    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(freed()).toEqual([first, late].sort());
  });

  it('is best-effort: a failed item delete is logged, the rest still go, and the list delete succeeds', async () => {
    const images = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => blobOf(alice, name));
    const items = await Item.create(
      images.map((imageUrl, i) => ({ wishlist: wishlistId, name: `Item ${i}`, imageUrl }))
    );
    const stuck = items[1]._id.toString();
    const realDelete = Item.findOneAndDelete.bind(Item);
    vi.spyOn(Item, 'findOneAndDelete').mockImplementation(((
      filter: { _id: unknown },
      ...rest: unknown[]
    ) =>
      String(filter._id) === stuck
        ? Promise.reject(new Error('boom'))
        : (realDelete as (...a: unknown[]) => unknown)(filter, ...rest)) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await deleteList(alice)).status).toBe(200);

    expect(await Wishlist.exists({ _id: wishlistId })).toBeNull();
    expect((await Item.find({ wishlist: wishlistId }).lean()).map((i) => String(i._id))).toEqual([
      stuck,
    ]);
    expect(freed()).toEqual([images[0], images[2]].sort());
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Item cleanup failed for deleted wishlist'),
      expect.any(Error)
    );
  });
});

describe('deleteAccount — a list owned alone', () => {
  it("deletes its items through the same path, freeing each item's image once", async () => {
    const solo = await Wishlist.create({ name: 'Solo', owners: [alice], visibility: 'everyone' });
    const image = blobOf(alice, 'solo.jpg');
    await Item.create({ wishlist: solo._id, name: 'Solo item', imageUrl: image });

    expect(await deleteAccount(alice, { agreedListIds: [solo._id.toString()] })).toBe('deleted');

    expect(await Wishlist.exists({ _id: solo._id })).toBeNull();
    expect(await Item.countDocuments({ wishlist: solo._id })).toBe(0);
    expect(del.mock.calls.filter(([url]) => url === image)).toHaveLength(1);
  });
});
