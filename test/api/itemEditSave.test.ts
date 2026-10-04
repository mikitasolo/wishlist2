import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Two co-owners edit the same item at once. The edit modal is filled from the
// item as the wishlist page listed it when the modal opened, so these tests fill
// it the same way (from the items GET), let the other owner save a change to
// the item, then save the modal the way it does: only what `itemChanges` says
// the owner changed.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    rates: new Map([
      ['usd', 1],
      ['eur', 0.9],
      ['gbp', 0.8],
    ]),
  }),
  convertToUsdCents: vi.fn(),
}));
// Record which blobs a save frees instead of talking to a store.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as GET_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { PATCH } from '@/app/api/items/[id]/route';
import {
  itemChanges,
  itemToFormData,
  type ItemContentChanges,
  type ItemFormData,
} from '@/lib/utils/itemForm';
import type { ApiItem } from '@/types/api';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const blobOf = (userId: string, name: string) => `${HOST}/uploads/${userId}/${name}`;

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
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
  wishlistId = (
    await Wishlist.create({
      name: 'Birthday',
      owners: [alice, bob],
      visibility: 'everyone',
      currency: 'USD',
    })
  )._id.toString();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function signIn(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

async function patch(itemId: string, userId: string, body: unknown) {
  signIn(userId);
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: itemId }) });
}

async function item(fields: Record<string, unknown>) {
  const created = await Item.create({ wishlist: wishlistId, name: 'Blue Mug', ...fields });
  return created._id.toString();
}

/** Open the edit modal: the item as the page lists it, and the form filled from it. */
async function openEdit(itemId: string, userId: string): Promise<ItemFormData> {
  signIn(userId);
  const res = await GET_ITEMS(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`),
    {
      params: Promise.resolve({ id: wishlistId }),
    }
  );
  const listed = ((await res.json()).data as ApiItem[]).find((i) => i._id === itemId)!;
  return itemToFormData(listed, 'USD');
}

/** Save the modal the way it does: only the content changed in it. */
async function save(
  itemId: string,
  userId: string,
  form: ItemFormData,
  change: Partial<ItemFormData>
): Promise<{ body: ItemContentChanges; res: Response }> {
  const body = itemChanges({ ...form, ...change }, form);
  return { body, res: await patch(itemId, userId, body) };
}

describe("saving an item edit leaves a co-owner's change made meanwhile alone", () => {
  // regression: the edit modal sent every content field as filled when it
  // opened. Alice's notes-only save wrote back her old upload, which Bob's
  // replacement had already freed, so the item pointed at a deleted blob, and
  // the write freed Bob's image as the one it replaced. It also undid his name.
  it('regression: a notes-only save keeps the image and name a co-owner just changed, and frees nothing', async () => {
    const alicesUpload = blobOf(alice, 'mug.webp');
    const bobsUpload = blobOf(bob, 'red-mug.webp');
    const id = await item({ imageUrl: alicesUpload });
    const alicesForm = await openEdit(id, alice);
    expect(alicesForm.imageUrl).toBe(alicesUpload);

    const bobs = await patch(id, bob, { name: 'Red Mug', imageUrl: bobsUpload });
    expect(bobs.status).toBe(200);
    // Bob's replacement freed Alice's upload.
    expect(del).toHaveBeenCalledWith(alicesUpload);
    del.mockClear();

    const { body, res } = await save(id, alice, alicesForm, { notes: 'Size M' });
    expect(body).toEqual({ notes: 'Size M' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      name: 'Red Mug',
      imageUrl: bobsUpload,
      notes: 'Size M',
    });

    expect(await Item.findById(id).lean()).toMatchObject({
      name: 'Red Mug',
      imageUrl: bobsUpload,
      notes: 'Size M',
    });
    expect(del).not.toHaveBeenCalled();
  });

  // regression: with the image the form loaded being Bob's upload, Alice's save
  // sent it back over his replacement and was refused as an image she hadn't
  // uploaded (FOREIGN_IMAGE_ERROR), though she never touched it.
  it("regression: a save doesn't fail over a co-owner's image the owner never touched", async () => {
    const bobsFirst = blobOf(bob, 'mug.webp');
    const bobsSecond = blobOf(bob, 'red-mug.webp');
    const id = await item({ imageUrl: bobsFirst });
    const alicesForm = await openEdit(id, alice);

    expect((await patch(id, bob, { imageUrl: bobsSecond })).status).toBe(200);
    del.mockClear();

    const { res } = await save(id, alice, alicesForm, { notes: 'Size M' });
    expect(res.status).toBe(200);
    expect(await Item.findById(id).lean()).toMatchObject({
      imageUrl: bobsSecond,
      notes: 'Size M',
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps every other field a co-owner changed: price, link, notes, most wanted', async () => {
    const id = await item({
      price: { value: 1250, currency: 'usd' },
      link: 'https://shop.example.com/mug',
      notes: 'Any colour',
      mostWanted: false,
    });
    const alicesForm = await openEdit(id, alice);

    const bobs = {
      price: { value: 900, currency: 'eur' },
      link: 'https://shop.example.com/red-mug',
      notes: 'Red, please',
      mostWanted: true,
    };
    expect((await patch(id, bob, bobs)).status).toBe(200);

    const { body, res } = await save(id, alice, alicesForm, { name: 'Big Blue Mug' });
    expect(body).toEqual({ name: 'Big Blue Mug' });
    expect(res.status).toBe(200);
    expect(await Item.findById(id).lean()).toMatchObject({ ...bobs, name: 'Big Blue Mug' });
  });

  it('still writes a field the owner did change, over the co-owner value for it', async () => {
    const id = await item({ price: { value: 1250, currency: 'usd' } });
    const alicesForm = await openEdit(id, alice);

    expect(
      (await patch(id, bob, { name: 'Red Mug', price: { value: 900, currency: 'eur' } })).status
    ).toBe(200);

    // The price is one field: Alice's new amount goes with the currency her form shows.
    const { body, res } = await save(id, alice, alicesForm, { price: '15' });
    expect(body).toEqual({ price: { value: 1500, currency: 'usd' } });
    expect(res.status).toBe(200);
    expect(await Item.findById(id).lean()).toMatchObject({
      name: 'Red Mug',
      price: { value: 1500, currency: 'usd' },
    });
  });

  it("frees the co-owner's image when the owner replaces it: the one the write replaced", async () => {
    const alicesFirst = blobOf(alice, 'mug.webp');
    const bobsUpload = blobOf(bob, 'red-mug.webp');
    const alicesSecond = blobOf(alice, 'green-mug.webp');
    const id = await item({ imageUrl: alicesFirst });
    const alicesForm = await openEdit(id, alice);

    expect((await patch(id, bob, { name: 'Red Mug', imageUrl: bobsUpload })).status).toBe(200);
    del.mockClear();

    const { body, res } = await save(id, alice, alicesForm, { imageUrl: alicesSecond });
    expect(body).toEqual({ imageUrl: alicesSecond });
    expect(res.status).toBe(200);
    expect(await Item.findById(id).lean()).toMatchObject({
      name: 'Red Mug',
      imageUrl: alicesSecond,
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(bobsUpload);
  });
});
