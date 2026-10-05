import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/migrations/uppercase-currency-codes/route';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  vi.stubEnv('MIGRATION_SECRET', 'right-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function run(secret: string | null = 'right-secret') {
  const req = new NextRequest('http://localhost/api/migrations/uppercase-currency-codes', {
    method: 'POST',
    headers: secret ? { 'X-Migration-Secret': secret } : {},
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

const LONG_AGO = new Date('2026-01-01T00:00:00Z');

/** An item row as stored before WIS-49 (the model now uppercases, so go around it). */
async function rawItem(price: { value: number; currency: string } | null) {
  const { insertedId } = await Item.collection.insertOne({
    wishlist: new Types.ObjectId(),
    name: 'Gift',
    status: 'available',
    price,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  });
  return insertedId;
}

async function reservation(itemPrice: { value: number; currency: string } | null) {
  const row = await Reservation.create({
    gifter: new Types.ObjectId(),
    wishlist: new Types.ObjectId(),
    item: new Types.ObjectId(),
    owner: new Types.ObjectId(),
    itemName: 'Gift',
    wishlistName: 'List',
    itemPrice,
  });
  return row._id;
}

async function giftLog(itemPrice: { value: number; currency: string } | null) {
  const row = await GiftLog.create({
    gifter: new Types.ObjectId(),
    giftedAt: LONG_AGO,
    itemName: 'Gift',
    itemPrice,
  });
  return row._id;
}

const itemRow = (id: Types.ObjectId) => Item.collection.findOne({ _id: id });
const reservationRow = (id: Types.ObjectId) => Reservation.collection.findOne({ _id: id });
const giftRow = (id: Types.ObjectId) => GiftLog.collection.findOne({ _id: id });

describe('POST /api/migrations/uppercase-currency-codes', () => {
  it('401s without the migration secret, and changes nothing', async () => {
    const id = await rawItem({ value: 100, currency: 'eur' });
    expect((await run(null)).status).toBe(401);
    expect((await run('wrong-secret')).status).toBe(401);
    expect((await itemRow(id))?.price).toEqual({ value: 100, currency: 'eur' });
  });

  it('uppercases lowercase codes on items, reservations and gift logs', async () => {
    const item = await rawItem({ value: 100, currency: 'eur' });
    const mixed = await rawItem({ value: 200, currency: 'Pln' });
    const held = await reservation({ value: 300, currency: 'usd' });
    const given = await giftLog({ value: 400, currency: 'gbp' });

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, items: 2, reservations: 1, giftLogs: 1 });

    expect((await itemRow(item))?.price).toEqual({ value: 100, currency: 'EUR' });
    expect((await itemRow(mixed))?.price).toEqual({ value: 200, currency: 'PLN' });
    expect((await reservationRow(held))?.itemPrice).toEqual({ value: 300, currency: 'USD' });
    expect((await giftRow(given))?.itemPrice).toEqual({ value: 400, currency: 'GBP' });
  });

  it('leaves uppercase codes, priceless rows and every other field alone', async () => {
    const upper = await rawItem({ value: 100, currency: 'EUR' });
    const priceless = await rawItem(null);
    const lower = await rawItem({ value: 100, currency: 'eur' });
    const unpricedHold = await reservation(null);
    const unpricedGift = await giftLog(null);
    const before = await itemRow(lower);

    const { body } = await run();
    expect(body).toMatchObject({ items: 1, reservations: 0, giftLogs: 0 });

    expect((await itemRow(upper))?.price).toEqual({ value: 100, currency: 'EUR' });
    expect((await itemRow(priceless))?.price).toBeNull();
    expect((await reservationRow(unpricedHold))?.itemPrice).toBeNull();
    expect((await giftRow(unpricedGift))?.itemPrice).toBeNull();
    // Only the code changed: not the name, the status, nor `updatedAt`, which an
    // open edit is saved against (a bump would refuse that save as stale).
    expect(await itemRow(lower)).toEqual({
      ...before,
      price: { value: 100, currency: 'EUR' },
    });
  });

  it('is a no-op when run again', async () => {
    const item = await rawItem({ value: 100, currency: 'eur' });
    await reservation({ value: 300, currency: 'usd' });
    await giftLog({ value: 400, currency: 'gbp' });
    await run();
    const after = await itemRow(item);

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, items: 0, reservations: 0, giftLogs: 0 });
    expect(await itemRow(item)).toEqual(after);
  });

  it('finishes a partial run: a row written lowercase after it is picked up next time', async () => {
    await rawItem({ value: 100, currency: 'eur' });
    await run();
    const late = await rawItem({ value: 500, currency: 'chf' });
    expect((await run()).body).toMatchObject({ items: 1 });
    expect((await itemRow(late))?.price).toEqual({ value: 500, currency: 'CHF' });
  });
});
