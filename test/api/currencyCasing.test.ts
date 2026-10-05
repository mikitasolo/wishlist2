import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-49: item prices (and the booking snapshots copied from them) are stored
// with an uppercase currency code, whatever casing a client sends.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Fixed rates, keyed lowercase as the rates API's are, with the real conversion.
vi.mock('@/lib/utils/currencyRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/currencyRates')>()),
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    // units per USD: 10.00 EUR is $20.00
    rates: new Map([
      ['usd', 1],
      ['eur', 0.5],
    ]),
  }),
}));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/items/[id]/route';
import { GET as LIST_ITEMS, POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);
const as = (userId: string) => session.mockResolvedValue({ user: { id: userId } } as never);

let ownerId: string;
let memberId: string;
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const member = await User.create({ email: 'member@x.com', username: 'member' });
  ownerId = owner._id.toString();
  memberId = member._id.toString();
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'everyone' });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: member._id });
});

async function create(body: unknown) {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await CREATE_ITEM(req, { params: Promise.resolve({ id: wishlistId }) });
  return { status: res.status, body: await res.json() };
}

async function patch(id: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/items/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function listed(id: string) {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`);
  const res = await LIST_ITEMS(req, { params: Promise.resolve({ id: wishlistId }) });
  const items: { _id: string; price?: unknown; priceInUsdCents?: number | null }[] = (
    await res.json()
  ).data;
  return items.find((i) => i._id === id);
}

async function storedCurrency(id: string) {
  const raw = await Item.collection.findOne({ _id: Item.castObject({ _id: id })._id });
  return (raw?.price as { currency: string } | undefined)?.currency;
}

describe('new item prices are stored uppercase', () => {
  it('stores a lowercase or padded code sent on create as uppercase', async () => {
    as(ownerId);
    const { status, body } = await create({
      name: 'Mug',
      price: { value: 1000, currency: ' eur' },
    });
    expect(status).toBe(201);
    expect(body.data.price).toEqual({ value: 1000, currency: 'EUR' });
    expect(await storedCurrency(body.data._id)).toBe('EUR');
    expect(body.data.priceInUsdCents).toBe(2000);
  });

  it('accepts an uppercase code against the lowercase rates map', async () => {
    as(ownerId);
    const { status, body } = await create({ name: 'Mug', price: { value: 500, currency: 'EUR' } });
    expect(status).toBe(201);
    expect(await storedCurrency(body.data._id)).toBe('EUR');
  });

  it('still refuses a code with no rate, in either casing', async () => {
    as(ownerId);
    for (const currency of ['jpy', 'JPY']) {
      const { status } = await create({ name: 'Mug', price: { value: 500, currency } });
      expect(status).toBe(400);
    }
    expect(await Item.countDocuments()).toBe(0);
  });

  it("stores an owner's edit uppercase", async () => {
    as(ownerId);
    const { body: created } = await create({ name: 'Mug' });
    const { status } = await patch(created.data._id, { price: { value: 700, currency: 'eur' } });
    expect(status).toBe(200);
    expect(await storedCurrency(created.data._id)).toBe('EUR');
  });

  it("stores a proposer's edit uppercase", async () => {
    as(memberId);
    const { body: created } = await create({ name: 'Idea', status: 'proposed' });
    const { status } = await patch(created.data._id, { price: { value: 700, currency: 'eur' } });
    expect(status).toBe(200);
    expect(await storedCurrency(created.data._id)).toBe('EUR');
  });

  it("snapshots a new item's uppercase price onto the booking", async () => {
    as(ownerId);
    const { body: created } = await create({ name: 'Mug', price: { value: 900, currency: 'eur' } });
    as(memberId);
    expect((await patch(created.data._id, { status: 'booked' })).status).toBe(200);
    const reservation = await Reservation.findOne({ item: created.data._id }).lean();
    expect(reservation?.itemPrice).toEqual({ value: 900, currency: 'EUR' });
  });
});
