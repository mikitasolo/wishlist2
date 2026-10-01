import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// A proposer may edit their item only while it's still their proposal, and the
// route decides that on the item as it first read it. So the edit must only be
// written if the item is still that proposal when the write lands. Each race
// below holds the proposer's item write while a concurrent change runs to
// completion, then lets it through: the order a real race only hits by luck.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records deletions instead of performing them, so a test can tell
// which images were freed.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH, DELETE } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';

let owner: string;
let alice: string;
let itemId: string;
// The image Alice proposed the item with, and a newer upload of hers.
let proposedImage: string;
let alicesNewImage: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  const [o, a] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'a@x.com', username: 'alice' },
  ]);
  [owner, alice] = [o, a].map((u) => u._id.toString());
  proposedImage = `${HOST}/uploads/${alice}/proposal-abc.jpg`;
  alicesNewImage = `${HOST}/uploads/${alice}/proposal-def.jpg`;
  const wl = await Wishlist.create({ name: 'Birthday', owners: [o._id], visibility: 'everyone' });
  await WishlistMember.create({ wishlist: wl._id, user: a._id });
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Blue Mug',
    notes: 'Size M',
    imageUrl: proposedImage,
    status: 'proposed',
    proposedBy: a._id,
  });
  itemId = item._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// `auth()` is the first thing the handler calls, synchronously on invocation, so
// a one-shot session is consumed by this call even while another is in flight.
function patchAs(user: string, body: unknown) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: itemId }) });
}

function deleteAs(user: string) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, { method: 'DELETE' });
  return DELETE(req, { params: Promise.resolve({ id: itemId }) });
}

/**
 * Hold the next item write (the proposer's edit, after all its reads and
 * checks) while `meanwhile` runs to completion, then let it land.
 */
const whileItemWriteHeld = <T>(meanwhile: () => Promise<T>) =>
  holdFirstCall(Item, 'findOneAndUpdate', meanwhile);

// The owner's review: approve the proposal, with their own edits to it.
const approval = {
  name: 'Blue Mug (large)',
  price: { value: 2500, currency: 'usd' },
  link: 'https://shop.example/blue-mug',
  notes: 'The large one',
};

describe("PATCH /api/items/[id] — a proposer's edit racing the owner's review", () => {
  // regression: the proposer's edit was decided on the item as first read (their
  // proposal) and then written on `{ _id }` alone. An owner approving it in
  // between was overwritten: the now-live item took the proposer's name, notes
  // and image, which only owners may edit, and the image the owner kept on it
  // was freed.
  it.each(['available', 'draft'] as const)(
    'regression: an owner approving it to %s first keeps the approved item as they left it, and the edit gets a 409',
    async (status) => {
      const race = whileItemWriteHeld(() => patchAs(owner, { ...approval, status }));
      const edit = await patchAs(alice, {
        name: 'Red Mug',
        notes: 'Any colour',
        imageUrl: alicesNewImage,
      });

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(edit.status).toBe(409);
      expect(await edit.json()).toEqual({
        success: false,
        error: 'This item is no longer a proposal you can edit',
      });

      const item = await Item.findById(itemId).lean();
      expect(item).toMatchObject({ ...approval, status, imageUrl: proposedImage });
      expect(item?.proposedBy).toBeNull();
      // The image the approval kept is still in place, and nothing was freed.
      expect(del).not.toHaveBeenCalled();
    }
  );

  // regression: same race, with the owner swapping in their own image as they
  // approve. The late edit put the proposer's image back over it, and freed the
  // one the approval had already replaced, leaving the owner's upload orphaned.
  it("regression: an owner approving it with their own image keeps that image, and frees the proposer's only once", async () => {
    const ownersImage = `${HOST}/uploads/${owner}/mug-large.jpg`;
    const race = whileItemWriteHeld(() =>
      patchAs(owner, { status: 'available', imageUrl: ownersImage })
    );
    const edit = await patchAs(alice, { imageUrl: alicesNewImage });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(edit.status).toBe(409);
    expect((await Item.findById(itemId))?.imageUrl).toBe(ownersImage);
    // Freed by the approval that replaced it, and by nothing else.
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  it.each([
    ['the owner rejecting it', () => owner],
    ['its proposer withdrawing it', () => alice],
  ])(
    'an edit that lands after %s gets a 404, writes nothing and frees nothing more',
    async (_, by) => {
      const race = whileItemWriteHeld(() => deleteAs(by()));
      const edit = await patchAs(alice, { name: 'Red Mug', imageUrl: alicesNewImage });

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(edit.status).toBe(404);
      expect((await edit.json()).error).toBe('Item not found');
      expect(await Item.countDocuments()).toBe(0);
      // Only the delete freed anything: the proposal's image, once.
      expect(del.mock.calls).toEqual([[proposedImage]]);
    }
  );

  // The write requires only what the edit rests on (still their proposal), so an
  // owner's edit that doesn't review it lands alongside instead of refusing it.
  it("an owner's edit that leaves it a proposal doesn't stop the proposer's, and neither is lost", async () => {
    const race = whileItemWriteHeld(() => patchAs(owner, { name: 'Blue Mug (large)' }));
    const edit = await patchAs(alice, { notes: 'Any colour' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(edit.status).toBe(200);
    const item = await Item.findById(itemId);
    expect([item?.status, item?.name, item?.notes]).toEqual([
      'proposed',
      'Blue Mug (large)',
      'Any colour',
    ]);
    expect(item?.proposedBy?.toString()).toBe(alice);
  });
});

describe("PATCH /api/items/[id] — a proposer's edit with no race", () => {
  it('lands while the item is still their proposal, and frees the image it replaced', async () => {
    const res = await patchAs(alice, { name: 'Red Mug', imageUrl: alicesNewImage });

    expect(res.status).toBe(200);
    const item = await Item.findById(itemId);
    expect([item?.status, item?.name, item?.imageUrl]).toEqual([
      'proposed',
      'Red Mug',
      alicesNewImage,
    ]);
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  // Only a request that passed the first-read check and then lost the race gets
  // the 409. One that reads the item already approved is refused as before.
  it('is refused with a 403, as before, once the item was approved before it was read', async () => {
    expect((await patchAs(owner, { ...approval, status: 'available' })).status).toBe(200);

    const res = await patchAs(alice, { name: 'Red Mug', imageUrl: alicesNewImage });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Insufficient permissions to update these fields');
    expect(await Item.findById(itemId).lean()).toMatchObject({
      ...approval,
      imageUrl: proposedImage,
    });
    expect(del).not.toHaveBeenCalled();
  });
});
