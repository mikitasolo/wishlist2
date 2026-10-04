import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as LIST_ITEMS, POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { PATCH } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

const KEY = '3f1c2a9e-4b7d-4e2a-9c1f-8d6b5a4e3c2b';

let ownerId: string;
let coOwnerId: string;
let memberId: string;
let wishlistId: string;
let otherListId: string;

function signIn(id: string) {
  session.mockResolvedValue({ user: { id } } as never);
}

function create(body: unknown, key: string | null = KEY, listId = wishlistId) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['Idempotency-Key'] = key;
  const req = new NextRequest(`http://localhost/api/wishlists/${listId}/items`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return CREATE_ITEM(req, { params: Promise.resolve({ id: listId }) });
}

function listItems() {
  const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`);
  return LIST_ITEMS(req, { params: Promise.resolve({ id: wishlistId }) });
}

beforeAll(async () => {
  await connectTestDB();
  // The unique partial index is what refuses a racing second create.
  await Item.syncIndexes();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const [owner, coOwner, member] = await User.create([
    { email: 'owner@x.com', username: 'owner' },
    { email: 'coowner@x.com', username: 'coowner' },
    { email: 'member@x.com', username: 'member' },
  ]);
  ownerId = owner._id.toString();
  coOwnerId = coOwner._id.toString();
  memberId = member._id.toString();
  const wl = await Wishlist.create({
    name: 'List',
    owners: [owner._id, coOwner._id],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: member._id });
  const other = await Wishlist.create({
    name: 'Other',
    owners: [owner._id],
    visibility: 'everyone',
  });
  otherListId = other._id.toString();
});

describe('POST /api/wishlists/[id]/items — a retried create (WIS-158)', () => {
  // regression: a retry of an add whose first POST was saved (its response
  // lost to a timeout) made a second copy of the item.
  it("answers a retry with the first attempt's item, and makes no second", async () => {
    signIn(ownerId);
    const first = await create({ name: 'Bike', status: 'available' });
    expect(first.status).toBe(201);
    const firstItem = (await first.json()).data;

    const retry = await create({ name: 'Bike', status: 'available' });
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.success).toBe(true);
    expect(body.data._id).toBe(firstItem._id);
    expect(body.data.priceInUsdCents).toBeNull();
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(1);
  });

  // regression: a member can't delete their own proposal, so a retried
  // proposal left the owners two to review, and notified them twice.
  it('answers a retried proposal with the first, notifying the owners once', async () => {
    signIn(memberId);
    const first = await (await create({ name: 'Lamp', status: 'proposed' })).json();
    const retry = await (await create({ name: 'Lamp', status: 'proposed' })).json();

    expect(retry.data._id).toBe(first.data._id);
    // Shaped for the proposer, as the first answer was: their own id only.
    expect(retry.data.proposedBy).toBe(memberId);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(1);
    expect(await Notification.countDocuments({ type: 'proposal' })).toBe(2); // one per owner
  });

  it('makes one item when two attempts of the same request race', async () => {
    signIn(ownerId);
    const answers = await Promise.all([
      create({ name: 'Bike', status: 'available' }),
      create({ name: 'Bike', status: 'available' }),
      create({ name: 'Bike', status: 'available' }),
    ]);
    const bodies = await Promise.all(answers.map((r) => r.json()));

    expect(bodies.every((b) => b.success)).toBe(true);
    expect(new Set(bodies.map((b) => b.data._id)).size).toBe(1);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(1);
  });

  it("never answers another user's key with their item: the same key makes their own", async () => {
    signIn(ownerId);
    const owners = await (await create({ name: 'Bike', status: 'draft' })).json();

    // A co-owner (who could see the item anyway) and a member (who must never
    // get an owner's draft) sending the very same key each make their own.
    signIn(coOwnerId);
    const coOwners = await create({ name: 'Kettle', status: 'available' });
    expect(coOwners.status).toBe(201);
    const coOwnersItem = (await coOwners.json()).data;

    signIn(memberId);
    const members = await create({ name: 'Lamp', status: 'proposed' });
    expect(members.status).toBe(201);
    const membersItem = (await members.json()).data;

    expect(coOwnersItem.name).toBe('Kettle');
    expect(membersItem.name).toBe('Lamp');
    expect(new Set([owners.data._id, coOwnersItem._id, membersItem._id]).size).toBe(3);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(3);
  });

  it('scopes a key to its list: the same key on another list makes a new item', async () => {
    signIn(ownerId);
    const here = await (await create({ name: 'Bike' })).json();
    const there = await create({ name: 'Bike' }, KEY, otherListId);

    expect(there.status).toBe(201);
    expect((await there.json()).data._id).not.toBe(here.data._id);
  });

  it('creates afresh once the first item is gone', async () => {
    signIn(ownerId);
    const first = await (await create({ name: 'Bike' })).json();
    await Item.deleteOne({ _id: first.data._id });

    const retry = await create({ name: 'Bike' });
    expect(retry.status).toBe(201);
    expect((await retry.json()).data._id).not.toBe(first.data._id);
  });

  it('re-checks access on a retry: a member removed since gets the refusal, not the item', async () => {
    signIn(memberId);
    await create({ name: 'Lamp', status: 'proposed' });
    await WishlistMember.deleteMany({ wishlist: wishlistId, user: memberId });

    const retry = await create({ name: 'Lamp', status: 'proposed' });
    expect(retry.status).toBe(403);
    expect((await retry.json()).data).toBeUndefined();
  });

  it("doesn't show a member their proposal once an owner has made it a draft", async () => {
    signIn(memberId);
    const first = await (await create({ name: 'Lamp', status: 'proposed' })).json();
    signIn(ownerId);
    const approve = new NextRequest(`http://localhost/api/items/${first.data._id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'draft' }),
    });
    expect((await PATCH(approve, { params: Promise.resolve({ id: first.data._id }) })).status).toBe(
      200
    );

    signIn(memberId);
    const retry = await create({ name: 'Lamp', status: 'proposed' });
    expect(retry.status).toBe(409);
    const body = await retry.json();
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/draft/i);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(1);
  });

  it('never puts the stored key in a response', async () => {
    signIn(ownerId);
    const created = await (await create({ name: 'Bike' })).json();
    const replayed = await (await create({ name: 'Bike' })).json();
    const listed = await (await listItems()).json();

    for (const item of [created.data, replayed.data, ...listed.data]) {
      expect(item).not.toHaveProperty('idempotencyKey');
    }
    // It is stored, scoped to its sender: not the key as sent.
    const stored = await Item.findById(created.data._id).select('+idempotencyKey').lean();
    expect(stored?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.idempotencyKey).not.toContain(KEY);
  });

  it('refuses a malformed key, and creates as before with none', async () => {
    signIn(ownerId);
    const bad = await create({ name: 'Bike' }, 'short');
    expect(bad.status).toBe(400);

    expect((await create({ name: 'Bike' }, null)).status).toBe(201);
    expect((await create({ name: 'Bike' }, null)).status).toBe(201);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(2);
  });
});
