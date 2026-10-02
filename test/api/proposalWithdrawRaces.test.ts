import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// A proposer may delete (withdraw) their item only while it's still their
// proposal, and the route decides that on the item as it first read it. So the
// delete must only take the item if it's still that proposal when the delete
// lands. Each race below holds the proposer's delete while a concurrent change
// runs to completion, then lets it through: the order a real race only hits by
// luck.

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

const NOT_OWNER_OR_PROPOSER = {
  success: false,
  error: 'Unauthorized - Owner or proposer access required',
};

let owner: string;
let coOwner: string;
let alice: string;
let itemId: string;
// The image Alice proposed the item with.
let proposedImage: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  const [o, b, a] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'b@x.com', username: 'bob' },
    { email: 'a@x.com', username: 'alice' },
  ]);
  [owner, coOwner, alice] = [o, b, a].map((u) => u._id.toString());
  proposedImage = `${HOST}/uploads/${alice}/proposal-abc.jpg`;
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [o._id, b._id],
    visibility: 'everyone',
  });
  await WishlistMember.create({ wishlist: wl._id, user: a._id });
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Blue Mug',
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
 * Hold the next item delete (the withdrawal, after all its reads and checks)
 * while `meanwhile` runs to completion, then let it land.
 */
const whileItemDeleteHeld = <T>(meanwhile: () => Promise<T>) =>
  holdFirstCall(Item, 'findOneAndDelete', meanwhile);

describe("DELETE /api/items/[id] — a proposer's withdrawal racing the owner's review", () => {
  // regression: the withdrawal was authorized on the item as first read (their
  // proposal) and then deleted on `{ _id }` alone. An owner approving it in
  // between made it a live item on the list, and the proposer's withdrawal
  // deleted it anyway, which only owners may do, and freed its image.
  it.each(['available', 'draft'] as const)(
    'regression: an owner approving it to %s first keeps the approved item and its image, and the withdrawal gets a 403',
    async (status) => {
      const race = whileItemDeleteHeld(() => patchAs(owner, { status }));
      const withdrawal = await deleteAs(alice);

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(withdrawal.status).toBe(403);
      expect(await withdrawal.json()).toEqual(NOT_OWNER_OR_PROPOSER);

      const item = await Item.findById(itemId).lean();
      expect(item).toMatchObject({ name: 'Blue Mug', status, imageUrl: proposedImage });
      expect(item?.proposedBy).toBeNull();
      expect(del).not.toHaveBeenCalled();
    }
  );

  // regression: same race, with the owner swapping in their own image as they
  // approve. The late withdrawal deleted the live item and freed the owner's
  // upload along with it.
  it("regression: an owner approving it with their own image keeps that image, and frees only the proposer's", async () => {
    const ownersImage = `${HOST}/uploads/${owner}/mug-large.jpg`;
    const race = whileItemDeleteHeld(() =>
      patchAs(owner, { status: 'available', imageUrl: ownersImage })
    );
    const withdrawal = await deleteAs(alice);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(withdrawal.status).toBe(403);
    expect((await Item.findById(itemId))?.imageUrl).toBe(ownersImage);
    // Freed by the approval that replaced it, and by nothing else.
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  it('a withdrawal that lands after the owner rejected it gets a 404, and frees nothing more', async () => {
    const race = whileItemDeleteHeld(() => deleteAs(owner));
    const withdrawal = await deleteAs(alice);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(withdrawal.status).toBe(404);
    expect((await withdrawal.json()).error).toBe('Item not found');
    expect(await Item.countDocuments()).toBe(0);
    // Only the owner's delete freed anything: the proposal's image, once.
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  // The delete requires only what the withdrawal rests on (still their
  // proposal), so an owner's edit that doesn't review it doesn't refuse it.
  it("an owner's edit that leaves it a proposal doesn't stop the withdrawal, which frees the image it had then", async () => {
    const ownersImage = `${HOST}/uploads/${owner}/mug-large.jpg`;
    const race = whileItemDeleteHeld(() =>
      patchAs(owner, { name: 'Blue Mug (large)', imageUrl: ownersImage })
    );
    const withdrawal = await deleteAs(alice);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(withdrawal.status).toBe(200);
    expect(await Item.countDocuments()).toBe(0);
    // The edit freed the image it replaced, the withdrawal the one it deleted.
    expect(del.mock.calls).toEqual([[proposedImage], [ownersImage]]);
  });

  // An owner may delete any item, so their delete isn't conditional on its
  // status: a co-owner's approval landing in between doesn't stop it.
  it("an owner's delete still goes through when a co-owner approves it in between", async () => {
    const race = whileItemDeleteHeld(() => patchAs(coOwner, { status: 'available' }));
    const res = await deleteAs(owner);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(res.status).toBe(200);
    expect(await Item.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });
});

describe("DELETE /api/items/[id] — a proposer's withdrawal with no race", () => {
  it('deletes their proposal and frees its image', async () => {
    const res = await deleteAs(alice);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: {} });
    expect(await Item.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  it('is refused with a 403, as before, once the item was approved before it was read', async () => {
    expect((await patchAs(owner, { status: 'available' })).status).toBe(200);

    const res = await deleteAs(alice);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_OWNER_OR_PROPOSER);
    expect(await Item.exists({ _id: itemId })).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });
});
