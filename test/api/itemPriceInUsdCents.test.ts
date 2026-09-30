import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// connectDB becomes a no-op; the in-memory mongoose connection backs the models.
vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Fixed rates instead of the DB/external API, but the real conversion, so the
// responses carry the value the price sorts actually compare.
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
import { GET as MY_ITEMS } from '@/app/api/users/me/items/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

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
  return { status: res.status, data: (await res.json()).data };
}

async function patch(id: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/items/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, data: (await res.json()).data };
}

// The item as the list read (what the next poll brings) shows it to the caller.
async function listed(id: string) {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`);
  const res = await LIST_ITEMS(req, { params: Promise.resolve({ id: wishlistId }) });
  const items: { _id: string; priceInUsdCents?: number | null }[] = (await res.json()).data;
  return items.find((i) => i._id === id);
}

async function makeItem(fields: Record<string, unknown> = {}) {
  const item = await Item.create({ wishlist: wishlistId, name: 'Gift', ...fields });
  return item._id.toString();
}

// regression: only the list GET added `priceInUsdCents`, and the page prepends
// the POST response as is, so under a price sort a priced new item sorted as
// unpriced (to the end) until the next poll.
describe('POST /api/wishlists/[id]/items — priceInUsdCents', () => {
  it('regression: carries a priced item in USD cents, the same value the list read gives', async () => {
    as(ownerId);
    const { status, data } = await create({
      name: 'Bike',
      price: { value: 1000, currency: 'eur' },
    });
    expect(status).toBe(201);
    expect(data.priceInUsdCents).toBe(2000);
    expect((await listed(data._id))?.priceInUsdCents).toBe(2000);
  });

  it('is null for an item without a price', async () => {
    as(ownerId);
    const { status, data } = await create({ name: 'Hug' });
    expect(status).toBe(201);
    expect(data.priceInUsdCents).toBeNull();
  });

  it("carries it on a member's proposal, which still shows the proposer their own id", async () => {
    as(memberId);
    const { status, data } = await create({
      name: 'Idea',
      status: 'proposed',
      price: { value: 1500, currency: 'usd' },
    });
    expect(status).toBe(201);
    expect(data.priceInUsdCents).toBe(1500);
    expect(data.proposedBy).toBe(memberId);
  });

  it('keeps the rest of the response shape: the stored item plus priceInUsdCents', async () => {
    as(ownerId);
    const { data } = await create({
      name: 'Bike',
      price: { value: 1000, currency: 'eur' },
      link: 'https://example.com/bike',
    });
    const { priceInUsdCents, ...rest } = data;
    expect(priceInUsdCents).toBe(2000);
    expect(rest).toEqual(JSON.parse(JSON.stringify(await Item.findById(data._id))));
  });
});

// regression: the PATCH response didn't carry `priceInUsdCents` either, and the
// page merges it over the listed item, so a re-priced item kept its old value
// and sorted by the old price until the next poll.
describe('PATCH /api/items/[id] — priceInUsdCents', () => {
  it('regression: returns the new value when an owner re-prices an item', async () => {
    const id = await makeItem({ price: { value: 1000, currency: 'usd' } });
    as(ownerId);

    const { status, data } = await patch(id, { price: { value: 1000, currency: 'eur' } });
    expect(status).toBe(200);
    expect(data.priceInUsdCents).toBe(2000);
    expect((await listed(id))?.priceInUsdCents).toBe(2000);
  });

  it('is null once the price is removed, and for an item that never had one', async () => {
    as(ownerId);
    const priced = await makeItem({ price: { value: 1000, currency: 'usd' } });
    expect((await patch(priced, { price: null })).data.priceInUsdCents).toBeNull();

    const priceless = await makeItem();
    const { status, data } = await patch(priceless, { name: 'Renamed' });
    expect(status).toBe(200);
    expect(data.priceInUsdCents).toBeNull();
  });

  it('carries the current value on an edit that leaves the price alone', async () => {
    const id = await makeItem({ price: { value: 1000, currency: 'eur' } });
    as(ownerId);
    expect((await patch(id, { name: 'Renamed' })).data.priceInUsdCents).toBe(2000);
  });

  it('carries it for every caller PATCH answers, with booking still hidden from the owner', async () => {
    const id = await makeItem({ price: { value: 1000, currency: 'eur' } });

    // A member booking it sees their booking.
    as(memberId);
    const booked = await patch(id, { status: 'booked' });
    expect(booked.data).toMatchObject({ status: 'booked', bookedBy: memberId });
    expect(booked.data.priceInUsdCents).toBe(2000);

    // The owner editing the booked item still gets it folded to available.
    as(ownerId);
    const edited = await patch(id, { price: { value: 3000, currency: 'usd' } });
    expect(edited.data.status).toBe('available');
    expect(edited.data.bookedBy).toBeUndefined();
    expect(edited.data.priceInUsdCents).toBe(3000);

    // The proposer re-pricing their own proposal.
    as(memberId);
    const proposal = await makeItem({ status: 'proposed', proposedBy: memberId });
    const proposed = await patch(proposal, { price: { value: 500, currency: 'eur' } });
    expect(proposed.data.proposedBy).toBe(memberId);
    expect(proposed.data.priceInUsdCents).toBe(1000);

    // A proposer who is no longer a member.
    await WishlistMember.deleteMany({ user: memberId });
    const again = await patch(proposal, { price: { value: 700, currency: 'usd' } });
    expect(again.status).toBe(200);
    expect(again.data.priceInUsdCents).toBe(700);
  });
});

// The owner's all-items page sorts by the same value, through the same helper.
describe('GET /api/users/me/items — priceInUsdCents', () => {
  it('matches the list read for priced and priceless items', async () => {
    const priced = await makeItem({ name: 'Bike', price: { value: 1000, currency: 'eur' } });
    const priceless = await makeItem({ name: 'Hug' });
    as(ownerId);

    const mine: { _id: string; priceInUsdCents: number | null }[] = (
      await (await MY_ITEMS()).json()
    ).data;
    const valueOf = (id: string) => mine.find((i) => i._id === id)?.priceInUsdCents;
    expect(valueOf(priced)).toBe(2000);
    expect(valueOf(priceless)).toBeNull();
    expect((await listed(priced))?.priceInUsdCents).toBe(2000);
  });
});

// regression: every read and write gated `priceInUsdCents` on a truthy
// `price.value`, so a free item (price 0, which the schemas accept) got null
// and the price sorts put it at the end with the priceless items instead of
// first under "price: low to high".
describe('a free (zero-priced) item — priceInUsdCents', () => {
  it('regression: is 0 from both list reads, while a priceless item stays null', async () => {
    const free = await makeItem({ name: 'Hug coupon', price: { value: 0, currency: 'eur' } });
    const priceless = await makeItem({ name: 'Hug' });
    as(ownerId);

    expect((await listed(free))?.priceInUsdCents).toBe(0);
    expect((await listed(priceless))?.priceInUsdCents).toBeNull();

    const mine: { _id: string; priceInUsdCents: number | null }[] = (
      await (await MY_ITEMS()).json()
    ).data;
    const valueOf = (id: string) => mine.find((i) => i._id === id)?.priceInUsdCents;
    expect(valueOf(free)).toBe(0);
    expect(valueOf(priceless)).toBeNull();
  });

  it('regression: is 0 on the create response', async () => {
    as(ownerId);
    const { status, data } = await create({ name: 'Free', price: { value: 0, currency: 'usd' } });
    expect(status).toBe(201);
    expect(data.priceInUsdCents).toBe(0);
  });

  it('regression: is 0 on the edit response once an item is re-priced to free', async () => {
    const id = await makeItem({ price: { value: 1000, currency: 'eur' } });
    as(ownerId);
    const { status, data } = await patch(id, { price: { value: 0, currency: 'eur' } });
    expect(status).toBe(200);
    expect(data.priceInUsdCents).toBe(0);
    expect((await listed(id))?.priceInUsdCents).toBe(0);
  });
});
