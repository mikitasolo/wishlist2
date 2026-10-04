import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-256: an item's notes may be 300 characters (they were 100), and a product
// link typed without a scheme is stored with https://.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { POST } from '@/app/api/wishlists/[id]/items/route';
import { PATCH } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';

const session = vi.mocked(auth);

let alice: string;
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  wishlistId = (
    await Wishlist.create({ name: 'Birthday', owners: [alice], visibility: 'everyone' })
  )._id.toString();
  session.mockResolvedValue({ user: { id: alice } } as never);
});

const create = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/wishlists/x/items', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: wishlistId }) }
  );

const update = (itemId: string, body: Record<string, unknown>) =>
  PATCH(
    new NextRequest('http://localhost/api/items/x', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: itemId }) }
  );

describe('item notes: 300 characters', () => {
  it('accepts notes of 300 characters and refuses 301, on create', async () => {
    const ok = await create({ name: 'Bike', notes: 'x'.repeat(300) });
    expect(ok.status).toBe(201);
    expect((await Item.findOne({ name: 'Bike' }))?.notes).toHaveLength(300);

    const tooLong = await create({ name: 'Other', notes: 'x'.repeat(301) });
    expect(tooLong.status).toBe(400);
    expect(await Item.countDocuments({ name: 'Other' })).toBe(0);
  });

  it('accepts notes of 300 characters and refuses 301, on edit', async () => {
    const item = await Item.create({ wishlist: wishlistId, name: 'Bike', status: 'available' });
    expect((await update(item._id.toString(), { notes: 'y'.repeat(300) })).status).toBe(200);
    expect((await update(item._id.toString(), { notes: 'y'.repeat(301) })).status).toBe(400);
    expect((await Item.findById(item._id))?.notes).toHaveLength(300);
  });
});

describe('item link', () => {
  it('stores a link typed without a scheme with https://', async () => {
    expect((await create({ name: 'Bike', link: 'amazon.de/dp/123' })).status).toBe(201);
    expect((await Item.findOne({ name: 'Bike' }))?.link).toBe('https://amazon.de/dp/123');
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/x', 'data:text/html,hi'])(
    'refuses %s',
    async (link) => {
      expect((await create({ name: 'Bike', link })).status).toBe(400);
    }
  );

  it('normalises a link on edit too', async () => {
    const item = await Item.create({ wishlist: wishlistId, name: 'Bike', status: 'available' });
    expect((await update(item._id.toString(), { link: 'etsy.com/x' })).status).toBe(200);
    expect((await Item.findById(item._id))?.link).toBe('https://etsy.com/x');
  });
});
