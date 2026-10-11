import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Item tags (WIS-385): owner-written only (never a member's, a proposer's or a
// copy's), at most 5 per item and 20 different ones per list, both held by the
// server, the list's cap re-checked after the write.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { auth } from '@/lib/auth';
import { GET, POST } from '@/app/api/wishlists/[id]/items/route';
import { PATCH } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import {
  LIST_TAGS_FULL_ERROR,
  LIST_TAGS_MAX,
  PROPOSAL_TAGS_ERROR,
  TAGS_DROPPED_NOTICE,
  TAGS_NOT_KEPT_NOTICE,
} from '@/lib/utils/itemTags';

const session = vi.mocked(auth);

let owner: string;
let coOwner: string;
let member: string;
let wishlistId: string;

const as = (id: string) => session.mockResolvedValue({ user: { id } } as never);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  vi.restoreAllMocks();
  owner = (await User.create({ email: 'o@x.com', username: 'owner' }))._id.toString();
  coOwner = (await User.create({ email: 'c@x.com', username: 'coowner' }))._id.toString();
  member = (await User.create({ email: 'm@x.com', username: 'member' }))._id.toString();
  wishlistId = (
    await Wishlist.create({ name: 'Birthday', owners: [owner, coOwner], visibility: 'everyone' })
  )._id.toString();
  await WishlistMember.create({ wishlist: wishlistId, user: member, role: 'member' });
  as(owner);
});

const create = (body: Record<string, unknown>, list = wishlistId) =>
  POST(
    new NextRequest(`http://localhost/api/wishlists/${list}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: list }) }
  );

const update = (itemId: string, body: Record<string, unknown>) =>
  PATCH(
    new NextRequest(`http://localhost/api/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: itemId }) }
  );

const read = () =>
  GET(new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`), {
    params: Promise.resolve({ id: wishlistId }),
  });

/** Items on the list carrying `count` different tags between them, `T1`…`Tn`. */
async function fillTags(count: number) {
  for (let i = 0; i < count; i += 5) {
    const tags = Array.from({ length: Math.min(5, count - i) }, (_, k) => `T${i + k + 1}`);
    await Item.create({ wishlist: wishlistId, name: `Filler ${i}`, status: 'available', tags });
  }
}

describe('an owner tagging an item', () => {
  it('stores and answers the tags of a new item, tidied and without repeats', async () => {
    const res = await create({ name: 'Novel', tags: ['  Books ', 'books', 'Gift  ideas'] });
    expect(res.status).toBe(201);
    expect((await res.json()).data.tags).toEqual(['Books', 'Gift ideas']);
    expect((await Item.findOne({ name: 'Novel' }))?.tags).toEqual(['Books', 'Gift ideas']);
  });

  it('fits a tag the list has already to its spelling', async () => {
    await Item.create({ wishlist: wishlistId, name: 'A', status: 'available', tags: ['Books'] });
    const res = await create({ name: 'Novel', tags: ['BOOKS'] });
    expect((await res.json()).data.tags).toEqual(['Books']);
  });

  it('replaces the tags on edit, and clears them with []', async () => {
    const item = await Item.create({ wishlist: wishlistId, name: 'Mug', status: 'available' });
    const id = item._id.toString();
    const res = await update(id, { tags: ['Kitchen', 'Mugs'] });
    expect(res.status).toBe(200);
    expect((await res.json()).data.tags).toEqual(['Kitchen', 'Mugs']);
    expect((await update(id, { tags: [] })).status).toBe(200);
    expect((await Item.findById(id))?.tags).toEqual([]);
  });

  it('refuses more than 5 tags on an item, or one over 24 characters', async () => {
    expect((await create({ name: 'A', tags: ['1', '2', '3', '4', '5', '6'] })).status).toBe(400);
    expect((await create({ name: 'B', tags: ['x'.repeat(25)] })).status).toBe(400);
    expect((await create({ name: 'C', tags: ['a\u0007b'] })).status).toBe(400);
    expect(await Item.countDocuments()).toBe(0);
  });

  it('leaves the tags alone on an edit that doesn’t send them', async () => {
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'available',
      tags: ['Kitchen'],
    });
    expect((await update(item._id.toString(), { name: 'Big mug' })).status).toBe(200);
    expect((await Item.findById(item._id))?.tags).toEqual(['Kitchen']);
  });
});

describe('the list’s cap of 20 different tags', () => {
  it('refuses a new tag past the cap, on create and on edit, and writes nothing', async () => {
    await fillTags(LIST_TAGS_MAX);
    const res = await create({ name: 'Novel', tags: ['Books'] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LIST_TAGS_FULL_ERROR);
    expect(await Item.countDocuments({ name: 'Novel' })).toBe(0);

    const item = await Item.create({ wishlist: wishlistId, name: 'Mug', status: 'available' });
    const edit = await update(item._id.toString(), { tags: ['Kitchen'], name: 'Renamed' });
    expect(edit.status).toBe(409);
    const after = await Item.findById(item._id);
    expect(after?.tags).toBeUndefined();
    expect(after?.name).toBe('Mug');
  });

  it('takes any tag the list has already, at the cap', async () => {
    await fillTags(LIST_TAGS_MAX);
    const res = await create({ name: 'Novel', tags: ['t3', 'T20'] });
    expect(res.status).toBe(201);
    expect((await res.json()).data.tags).toEqual(['T3', 'T20']);
  });

  it('counts an item’s own old tags out of the cap when they’re replaced', async () => {
    await fillTags(LIST_TAGS_MAX - 1);
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'available',
      tags: ['Old'],
    });
    // 20 with Old; swapping Old for New stays at 20.
    expect((await update(item._id.toString(), { tags: ['New'] })).status).toBe(200);
  });

  it('lets an item keep a tag only it carries on a list past the cap', async () => {
    await fillTags(LIST_TAGS_MAX);
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'available',
      tags: ['Own', 'T1'],
    });
    // 21 different tags (left by an old race); dropping T1 while keeping Own is fine.
    expect((await update(item._id.toString(), { tags: ['Own'] })).status).toBe(200);
  });

  // regression: two co-owners each adding the list's last free tag at once both
  // pass the check made before the write; the re-check after it takes back the
  // one that lands over the cap.
  it('takes an edit’s tags back when a co-owner’s new tag landed meanwhile', async () => {
    await fillTags(LIST_TAGS_MAX - 1);
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'available',
      tags: ['T1'],
    });
    const realWrite = Item.findOneAndUpdate.bind(Item);
    vi.spyOn(Item, 'findOneAndUpdate').mockImplementationOnce(((...args: unknown[]) => {
      // The co-owner's item, with another new tag, lands between the check and the write.
      return Item.create({
        wishlist: wishlistId,
        name: 'Racer',
        status: 'available',
        tags: ['Theirs'],
      }).then(() => (realWrite as (...a: unknown[]) => unknown)(...args));
    }) as never);

    const res = await update(item._id.toString(), { tags: ['T1', 'Mine'], name: 'Big mug' });
    // The rest of the edit landed, so it's answered as saved, with a notice.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notice).toBe(TAGS_NOT_KEPT_NOTICE);
    expect(body.data).toMatchObject({ name: 'Big mug', tags: ['T1'] });
    const after = await Item.findById(item._id);
    expect(after?.tags).toEqual(['T1']);
    expect(after?.name).toBe('Big mug');
  });

  // regression: the same race on a create keeps the item but none of its tags.
  it('saves a new item without its tags when a co-owner’s new tag landed meanwhile', async () => {
    await fillTags(LIST_TAGS_MAX - 1);
    const realCreate = Item.create.bind(Item);
    vi.spyOn(Item, 'create').mockImplementationOnce(((doc: unknown) =>
      realCreate({
        wishlist: wishlistId,
        name: 'Racer',
        status: 'available',
        tags: ['Theirs'],
      }).then(() => realCreate(doc as never))) as never);

    const res = await create({ name: 'Novel', tags: ['Mine', 'T2'] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.notice).toBe(TAGS_DROPPED_NOTICE);
    expect(body.data.tags).toEqual([]);
    expect((await Item.findOne({ name: 'Novel' }))?.tags).toEqual([]);
  });
});

describe('nobody but an owner writes tags', () => {
  it('refuses a member’s proposal that carries tags, and makes nothing', async () => {
    as(member);
    const res = await create({ name: 'Idea', status: 'proposed', tags: ['Books'] });
    expect(res.status).toBe(403);
    expect(await Item.countDocuments()).toBe(0);
  });

  it('refuses a member’s edit of tags, a reserve with tags included', async () => {
    const item = await Item.create({ wishlist: wishlistId, name: 'Mug', status: 'available' });
    as(member);
    expect((await update(item._id.toString(), { tags: ['Mine'] })).status).toBe(403);
    expect((await update(item._id.toString(), { status: 'booked', tags: ['Mine'] })).status).toBe(
      403
    );
    const after = await Item.findById(item._id);
    expect(after?.tags).toBeUndefined();
    expect(after?.status).toBe('available');
  });

  it('refuses a proposer’s tags on their own proposal', async () => {
    const proposal = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: member,
    });
    as(member);
    expect((await update(proposal._id.toString(), { tags: ['Mine'] })).status).toBe(403);
    expect((await Item.findById(proposal._id))?.tags).toBeUndefined();
  });

  it('refuses an owner’s tags on a proposal, unless the same edit adds it to the list', async () => {
    const proposal = await Item.create({
      wishlist: wishlistId,
      name: 'Idea',
      status: 'proposed',
      proposedBy: member,
    });
    const id = proposal._id.toString();
    const res = await update(id, { tags: ['Books'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PROPOSAL_TAGS_ERROR);
    expect((await Item.findById(id))?.tags).toBeUndefined();

    expect((await update(id, { tags: ['Books'], status: 'available' })).status).toBe(200);
    expect(await Item.findById(id)).toMatchObject({ status: 'available', tags: ['Books'] });
  });

  it('saves a copy ("Save to my list") without the tags it was sent', async () => {
    const other = (
      await Wishlist.create({ name: 'Theirs', owners: [member], visibility: 'everyone' })
    )._id.toString();
    const source = await Item.create({
      wishlist: other,
      name: 'Lamp',
      status: 'available',
      tags: ['Lights'],
    });
    const res = await create({ name: 'Lamp', sourceItemId: String(source._id), tags: ['Lights'] });
    expect(res.status).toBe(201);
    expect((await Item.findOne({ wishlist: wishlistId, name: 'Lamp' }))?.tags).toBeUndefined();
  });
});

describe('who sees tags', () => {
  it('answers a booked item’s tags to an owner as on any item, still not booked', async () => {
    await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'booked',
      bookedBy: member,
      tags: ['Kitchen'],
    });
    const { data } = await (await read()).json();
    expect(data[0]).toMatchObject({ status: 'available', tags: ['Kitchen'] });
    expect(data[0].bookedBy).toBeUndefined();
  });

  it('never sends a member a draft, so never its tags', async () => {
    await Item.create({ wishlist: wishlistId, name: 'Secret', status: 'draft', tags: ['Hidden'] });
    await Item.create({
      wishlist: wishlistId,
      name: 'Mug',
      status: 'available',
      tags: ['Kitchen'],
    });
    as(member);
    const { data } = await (await read()).json();
    expect(data.map((i: { tags?: string[] }) => i.tags)).toEqual([['Kitchen']]);
  });
});
