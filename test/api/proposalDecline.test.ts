import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// An owner answers a proposal from its review dialog (WIS-257): Add to list or
// Add as draft approve it through PATCH, with the status of the button pressed
// and only the content the owner changed; Decline deletes it through DELETE,
// and tells the proposer nothing (D12).

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
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
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';

let owner: string;
let coOwner: string;
let alice: string;
let bob: string;
let itemId: string;
let proposedImage: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  const [o, c, a, b] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'c@x.com', username: 'coowner' },
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
  ]);
  [owner, coOwner, alice, bob] = [o, c, a, b].map((u) => u._id.toString());
  proposedImage = `${HOST}/uploads/${alice}/proposal-abc.jpg`;
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [o._id, c._id],
    visibility: 'everyone',
  });
  await WishlistMember.create([
    { wishlist: wl._id, user: a._id },
    { wishlist: wl._id, user: b._id },
  ]);
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
  vi.unstubAllEnvs();
});

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

describe('declining a proposal', () => {
  it('deletes it, frees its image, and creates no notification for the proposer', async () => {
    const res = await deleteAs(owner);
    expect(res.status).toBe(200);

    expect(await Item.findById(itemId)).toBeNull();
    expect(del.mock.calls).toEqual([[proposedImage]]);
    // Silent (D12): nobody is told, the proposer above all.
    expect(await Notification.countDocuments({ user: alice })).toBe(0);
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it("is an owner's act: another member can't decline it", async () => {
    const res = await deleteAs(bob);
    expect(res.status).toBe(403);
    expect(await Item.findById(itemId)).not.toBeNull();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('approving a proposal from the review dialog', () => {
  it('adds it as a draft from the status alone, keeping the proposed content', async () => {
    const res = await patchAs(owner, { status: 'draft' });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The proposer stays anonymous to the owner in the answer too.
    expect(body.data.proposedBy).toBeUndefined();

    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ status: 'draft', name: 'Blue Mug', notes: 'Size M' });
    expect(item!.proposedBy).toBeNull();
    expect(item!.imageUrl).toBe(proposedImage);
    expect(del).not.toHaveBeenCalled();
  });

  // The dialog sends only what the owner changed, so a field they didn't touch
  // keeps what the proposer saved after the dialog opened (part of WIS-199).
  it("keeps the proposer's later edit of a field the owner didn't change", async () => {
    const edit = await patchAs(alice, { notes: 'Size L' });
    expect(edit.status).toBe(200);

    const res = await patchAs(coOwner, { name: 'Blue mug, large', status: 'available' });
    expect(res.status).toBe(200);
    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ status: 'available', name: 'Blue mug, large', notes: 'Size L' });
  });
});
