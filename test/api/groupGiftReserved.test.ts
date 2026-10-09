import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-363: group gifts on the Reserved page. A contributor's card stays active
// while they're in the live gift (its item is booked by the organizer alone),
// carries the gift only to people in it, and Mark as given logs their own share,
// never the item's whole price.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    rates: new Map([
      ['usd', 1],
      ['eur', 0.9],
    ]),
  }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@vercel/blob', () => ({ copy: vi.fn(), del: vi.fn(), list: vi.fn(), put: vi.fn() }));

import { GET as getReservations } from '@/app/api/users/me/reservations/route';
import { GET as getSummary } from '@/app/api/users/me/reservations/summary/route';
import { POST as giveReservation } from '@/app/api/reservations/[id]/gift/route';
import { GET as getWishlists } from '@/app/api/wishlists/route';
import { DELETE as kickRoute } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import GroupGift from '@/models/GroupGift';
import { __setRateLimiters } from '@/lib/rateLimit';
import { needsConfirmation } from '@/lib/utils/reservations';
import { api, as, json, seedWorld, session, type World } from './groupGiftHarness';

let w: World;
const a = api(() => w);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  __setRateLimiters(null);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', ['vercel', 'blob', 'rw', 'TestStore42', 'x'].join('_'));
  w = await seedWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

interface Card {
  _id: string;
  itemId: string;
  itemPrice: { value: number; currency: string } | null;
  pledge: { value: number; currency: string } | null;
  itemStatus: string | null;
  stillReserved: boolean | null;
  listOpen: boolean;
  listArchived: boolean;
  groupGift: null | {
    contributing: true;
    organizer: boolean;
    target: { value: number; currency: string };
    pledgedTotal: number;
    percentFunded: number;
    contributors: { name: string; pledged: number; organizer: boolean; you: boolean }[];
  };
}

async function reservedBy(user: string): Promise<{ cards: Card[]; raw: string }> {
  as(user);
  const res = await getReservations();
  expect(res.status).toBe(200);
  const raw = await res.text();
  return { cards: JSON.parse(raw).data, raw };
}

async function changedCount(user: string): Promise<number> {
  as(user);
  return (await (await getSummary()).json()).data.changed;
}

function give(user: string, reservationId: string) {
  as(user);
  return giveReservation(json(`/api/reservations/${reservationId}/gift`, 'POST'), {
    params: Promise.resolve({ id: reservationId }),
  });
}

function kick(who: 'alice' | 'bob' | 'carol') {
  as(w.owner);
  const memberId = w.membership[who];
  return kickRoute(json(`/api/wishlists/${w.wishlistId}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: w.wishlistId, memberId }),
  });
}

/** Alice starts a gift with $30 of the $100 camera, Bob joins with $20. */
async function aliceAndBob() {
  expect((await a.start(w.alice, { pledged: 3000 })).status).toBe(201);
  expect((await a.pledge(w.bob, 2000)).status).toBe(200);
}

describe('GET /api/users/me/reservations — group gifts', () => {
  it('regression: a contributor who isn’t the organizer still holds the gift, not "released"', async () => {
    // Cause: the live state only knew `bookedBy`, which is the organizer alone.
    await aliceAndBob();
    const { cards } = await reservedBy(w.bob);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.stillReserved).toBe(true);
    expect(needsConfirmation(card)).toBe(false);
    expect(card.pledge).toEqual({ value: 2000, currency: 'USD' });
    expect(card.groupGift).toEqual({
      contributing: true,
      organizer: false,
      status: 'open',
      target: { value: 10000, currency: 'USD' },
      pledgedTotal: 5000,
      percentFunded: 50,
      contributors: [
        { name: 'alice', pledged: 3000, organizer: true, you: false },
        { name: 'bob', pledged: 2000, organizer: false, you: true },
      ],
    });
    expect(await changedCount(w.bob)).toBe(0);
  });

  it('the organizer’s card carries the gift too, as theirs to organize', async () => {
    await aliceAndBob();
    const [card] = (await reservedBy(w.alice)).cards;
    expect(card.stillReserved).toBe(true);
    expect(card.pledge).toEqual({ value: 3000, currency: 'USD' });
    expect(card.groupGift?.organizer).toBe(true);
    expect(await changedCount(w.alice)).toBe(0);
  });

  it('only your own gifts: a member not in it gets nothing of it, and never names or amounts', async () => {
    await aliceAndBob();
    // Carol holds a solo booking elsewhere on the list.
    const other = await Item.create({ wishlist: w.wishlistId, name: 'Lens' });
    await Item.updateOne({ _id: other._id }, { status: 'booked', bookedBy: w.carol });
    await Reservation.create({
      gifter: w.carol,
      wishlist: w.wishlistId,
      item: other._id,
      owner: w.owner,
      itemName: 'Lens',
      wishlistName: 'Birthday',
    });
    const { cards, raw } = await reservedBy(w.carol);
    expect(cards.map((c) => c.itemId)).toEqual([other._id.toString()]);
    expect(cards[0].groupGift).toBeNull();
    expect(cards[0].pledge).toBeNull();
    for (const leak of ['alice', 'bob', w.alice, w.bob, '3000', '2000', 'contributors']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('an owner’s reservations read says nothing of a gift on their list', async () => {
    await aliceAndBob();
    const { cards, raw } = await reservedBy(w.owner);
    expect(cards).toEqual([]);
    expect(raw).not.toContain('alice');
  });

  it('an archived list freezes the card: its snapshot and your own share only', async () => {
    await aliceAndBob();
    await Wishlist.updateOne({ _id: w.wishlistId }, { archived: true });
    const { cards, raw } = await reservedBy(w.bob);
    const [card] = cards;
    expect(card.listArchived).toBe(true);
    expect(card.stillReserved).toBeNull();
    expect(card.itemStatus).toBeNull();
    expect(card.groupGift).toBeNull();
    expect(card.pledge).toEqual({ value: 2000, currency: 'USD' });
    for (const leak of ['alice', '3000', 'contributors', 'percentFunded']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('a contributor kicked from the list is out of the gift: no live gift on their card', async () => {
    await aliceAndBob();
    expect((await kick('bob')).status).toBe(200);
    const { cards, raw } = await reservedBy(w.bob);
    const [card] = cards;
    expect(needsConfirmation(card)).toBe(true);
    expect(card.groupGift).toBeNull();
    expect(raw).not.toContain('alice');
  });
});

describe('Mark as given from the Reserved page', () => {
  it('a contributor still in the live gift is refused: the organizer gives it for everyone', async () => {
    await aliceAndBob();
    const [card] = (await reservedBy(w.bob)).cards;
    const res = await give(w.bob, card._id);
    expect(res.status).toBe(409);
    expect(await Reservation.exists({ _id: card._id })).toBeTruthy();
    expect(await GiftLog.countDocuments()).toBe(0);
  });

  it('regression: logs the contributor’s pledge, never the full price, once the owner ended the item', async () => {
    // Cause: the gift route logged the Reservation's item price.
    await aliceAndBob();
    expect((await a.patchItem(w.owner, { status: 'completed' })).status).toBe(200);
    const [card] = (await reservedBy(w.bob)).cards;
    expect(needsConfirmation(card)).toBe(true);
    const res = await give(w.bob, card._id);
    expect(res.status).toBe(201);
    expect((await res.json()).data.itemPrice).toEqual({ value: 2000, currency: 'USD' });
  });

  it('regression: a kicked contributor logs the share they had, though the gift no longer holds it', async () => {
    await aliceAndBob();
    await kick('bob');
    const [card] = (await reservedBy(w.bob)).cards;
    const res = await give(w.bob, card._id);
    expect(res.status).toBe(201);
    expect((await res.json()).data.itemPrice).toEqual({ value: 2000, currency: 'USD' });
  });

  it('a frozen card on an archived list logs the share too', async () => {
    await aliceAndBob();
    await Wishlist.updateOne({ _id: w.wishlistId }, { archived: true });
    const [card] = (await reservedBy(w.bob)).cards;
    const res = await give(w.bob, card._id);
    expect(res.status).toBe(201);
    expect((await res.json()).data.itemPrice).toEqual({ value: 2000, currency: 'USD' });
  });

  it('the organizer’s Mark as given logs each contributor’s own pledge', async () => {
    await aliceAndBob();
    expect((await a.give(w.alice)).status).toBe(200);
    const logs = await GiftLog.find().lean();
    const byGifter = new Map(logs.map((l) => [l.gifter.toString(), l.itemPrice]));
    expect(byGifter.get(w.alice)).toMatchObject({ value: 3000, currency: 'USD' });
    expect(byGifter.get(w.bob)).toMatchObject({ value: 2000, currency: 'USD' });
    expect((await reservedBy(w.bob)).cards).toEqual([]);
  });
});

describe('the Reservation’s share follows the pledge', () => {
  it('a pledge change updates it', async () => {
    await aliceAndBob();
    expect((await a.pledge(w.bob, 4500)).status).toBe(200);
    const r = await Reservation.findOne({ gifter: w.bob }).lean();
    expect(r?.pledge).toMatchObject({ value: 4500, currency: 'USD' });
  });

  it('converting to a solo booking leaves the organizer no share: the whole price is theirs', async () => {
    await aliceAndBob();
    expect((await a.convert(w.alice)).status).toBe(200);
    const r = await Reservation.findOne({ gifter: w.alice }).lean();
    expect(r?.pledge).toBeNull();
    const [card] = (await reservedBy(w.alice)).cards;
    expect(card.stillReserved).toBe(true);
    expect(card.groupGift).toBeNull();
  });

  it('a solo booking replacing an old contribution’s Reservation drops the share', async () => {
    await aliceAndBob();
    // The owner drafts the item (the gift ends, Reservations kept), then
    // publishes it again; Bob books it alone.
    expect((await a.patchItem(w.owner, { status: 'draft' })).status).toBe(200);
    expect((await a.patchItem(w.owner, { status: 'available' })).status).toBe(200);
    expect((await a.patchItem(w.bob, { status: 'booked' })).status).toBe(200);
    const r = await Reservation.findOne({ gifter: w.bob }).lean();
    expect(r?.pledge).toBeNull();
  });
});

describe('"N reserved by you" on the dashboard', () => {
  async function reservedByYou(user: string): Promise<number | undefined> {
    session.mockResolvedValue({ user: { id: user } } as never);
    const res = await getWishlists(new NextRequest('http://localhost/api/wishlists'));
    const { member } = (await res.json()).data as {
      member: { _id: string; reservedByYou?: number }[];
    };
    return member.find((m) => m._id === w.wishlistId)?.reservedByYou;
  }

  it('regression: counts the gift for every contributor, once, and not for anyone else', async () => {
    // Cause: only `bookedBy` (the organizer) was counted.
    await aliceAndBob();
    expect(await reservedByYou(w.alice)).toBe(1);
    expect(await reservedByYou(w.bob)).toBe(1);
    expect(await reservedByYou(w.carol)).toBe(0);
  });

  it('stops counting a gift that has ended', async () => {
    await aliceAndBob();
    await a.cancel(w.alice);
    expect(await GroupGift.exists({ active: true })).toBeNull();
    expect(await reservedByYou(w.bob)).toBe(0);
  });
});
