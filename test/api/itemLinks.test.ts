import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// Linked items (WIS-29): an owner links items on a list that go together, and
// everyone who can see an item sees "Goes with" chips. These pin that a link is
// symmetric, same-list, owner-only, never on a proposal, capped at 10 on both
// sides (races included), cleaned up on delete, remapped by a list copy, and
// that a chip is only a partner the viewer may see, as `{ id, name }`.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: vi.fn().mockResolvedValue(undefined),
  head: vi.fn(),
  list: vi.fn().mockResolvedValue({ blobs: [], cursor: undefined }),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as LIST_ITEMS, POST as CREATE_ITEM } from '@/app/api/wishlists/[id]/items/route';
import { DELETE as DELETE_ITEM, PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { POST as COPY_LIST } from '@/app/api/wishlists/[id]/copy/route';
import { __setRateLimiters } from '@/lib/rateLimit';
import {
  LINK_CAP_ERROR,
  LINK_PROPOSAL_ERROR,
  LINK_SELF_ERROR,
  LINK_TARGET_ERROR,
  partnerCapError,
} from '@/lib/utils/itemLinkWrites';
import { ITEM_LINKS_MAX } from '@/lib/utils/itemLinks';
import { IDEMPOTENCY_HEADER } from '@/lib/utils/itemIdempotency';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);

let alice: string; // owns the list
let carol: string; // a member of it
let erin: string; // nobody to it (it's public)
let list: string;
let other: string; // another list of alice's

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  carol = await user('carol');
  erin = await user('erin');
  list = (
    await Wishlist.create({ name: 'Tools', owners: [alice], visibility: 'everyone' })
  )._id.toString();
  other = (
    await Wishlist.create({ name: 'Books', owners: [alice], visibility: 'everyone' })
  )._id.toString();
  await WishlistMember.create({ wishlist: list, user: carol });
});
afterEach(() => {
  vi.restoreAllMocks();
  __setRateLimiters(null);
});

function as(userId: string | null) {
  session.mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

let made = 0;
const makeItem = (fields: Record<string, unknown> = {}, wishlist = list) =>
  Item.create({ wishlist, name: `Item ${++made}`, ...fields });

const patch = (id: string, body: unknown) =>
  PATCH_ITEM(
    new NextRequest(`http://localhost/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(String(id))
  );

const create = (body: unknown, wishlist = list, key?: string) =>
  CREATE_ITEM(
    new NextRequest(`http://localhost/api/wishlists/${wishlist}/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
      },
      body: JSON.stringify(body),
    }),
    params(wishlist)
  );

const remove = (id: string) =>
  DELETE_ITEM(
    new NextRequest(`http://localhost/api/items/${id}`, { method: 'DELETE' }),
    params(String(id))
  );

/** The list's items as `userId` reads them, by name. */
async function readAs(userId: string | null) {
  as(userId);
  const res = await LIST_ITEMS(
    new NextRequest(`http://localhost/api/wishlists/${list}/items`),
    params(list)
  );
  expect(res.status).toBe(200);
  const { data } = await res.json();
  return new Map<string, { relatedItems: { id: string; name: string }[] }>(
    data.map((item: { name: string }) => [item.name, item])
  );
}

const stored = async (id: unknown) =>
  ((await Item.findById(id).lean())?.relatedItems ?? []).map(String).sort();

/** Two items recorded as linked on both sides, as a write leaves them. */
async function linkDirectly(
  a: { _id: mongoose.Types.ObjectId },
  b: { _id: mongoose.Types.ObjectId }
) {
  await Item.updateOne({ _id: a._id }, { $addToSet: { relatedItems: b._id } });
  await Item.updateOne({ _id: b._id }, { $addToSet: { relatedItems: a._id } });
}

describe('linking and unlinking (owners)', () => {
  it('links both sides, answers the edited item’s partners, and unlinks both sides', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    as(alice);

    const res = await patch(drill._id.toString(), { linkItems: [bits._id.toString()] });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.relatedItems).toEqual([{ id: bits._id.toString(), name: 'Bits' }]);
    expect(await stored(drill._id)).toEqual([bits._id.toString()]);
    expect(await stored(bits._id)).toEqual([drill._id.toString()]);

    // Unlinked from the other side: gone from both.
    const off = await patch(bits._id.toString(), { unlinkItems: [drill._id.toString()] });
    expect(off.status).toBe(200);
    expect((await off.json()).data.relatedItems).toEqual([]);
    expect(await stored(drill._id)).toEqual([]);
    expect(await stored(bits._id)).toEqual([]);
  });

  it('links a new item at create, both sides', async () => {
    const drill = await makeItem({ name: 'Drill' });
    as(alice);

    const res = await create({ name: 'Bits', linkItems: [drill._id.toString()] });

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.relatedItems).toEqual([{ id: drill._id.toString(), name: 'Drill' }]);
    expect(await stored(drill._id)).toEqual([data._id]);
  });

  it('links drafts too, and a content edit with links never changes the status', async () => {
    const draft = await makeItem({ name: 'Case', status: 'draft' });
    const booked = await makeItem({ name: 'Drill', status: 'booked', bookedBy: carol });
    as(alice);

    const res = await patch(booked._id.toString(), {
      notes: 'The cordless one',
      linkItems: [draft._id.toString()],
    });

    expect(res.status).toBe(200);
    const after = await Item.findById(booked._id).lean();
    expect(after?.status).toBe('booked');
    expect(String(after?.bookedBy)).toBe(carol);
    expect(after?.notes).toBe('The cordless one');
    expect(await stored(draft._id)).toEqual([booked._id.toString()]);
  });

  it('refuses a member, a link to itself, another list’s item and a proposal, writing nothing', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    const elsewhere = await makeItem({ name: 'Novel' }, other);
    const proposal = await makeItem({ name: 'Gloves', status: 'proposed', proposedBy: carol });

    as(carol);
    const member = await patch(drill._id.toString(), { linkItems: [bits._id.toString()] });
    expect(member.status).toBe(403);
    const memberCreate = await create({
      name: 'Saw',
      status: 'proposed',
      linkItems: [bits._id.toString()],
    });
    expect(memberCreate.status).toBe(403);

    as(alice);
    const self = await patch(drill._id.toString(), {
      name: 'Drill 2',
      linkItems: [drill._id.toString()],
    });
    expect(self.status).toBe(400);
    expect((await self.json()).error).toBe(LINK_SELF_ERROR);

    const cross = await patch(drill._id.toString(), { linkItems: [elsewhere._id.toString()] });
    expect(cross.status).toBe(400);
    expect((await cross.json()).error).toBe(LINK_TARGET_ERROR);

    const toProposal = await patch(drill._id.toString(), { linkItems: [proposal._id.toString()] });
    expect(toProposal.status).toBe(400);
    expect((await toProposal.json()).error).toBe(LINK_TARGET_ERROR);

    const ofProposal = await patch(proposal._id.toString(), { linkItems: [drill._id.toString()] });
    expect(ofProposal.status).toBe(400);
    expect((await ofProposal.json()).error).toBe(LINK_PROPOSAL_ERROR);

    const missing = await patch(drill._id.toString(), {
      linkItems: [new mongoose.Types.ObjectId().toString()],
    });
    expect(missing.status).toBe(400);

    for (const item of [drill, bits, elsewhere, proposal])
      expect(await stored(item._id)).toEqual([]);
    // The refused self-link wrote none of the edit either.
    expect((await Item.findById(drill._id).lean())?.name).toBe('Drill');
  });

  it('never copies links with a single item (Save to my list)', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const mine = await makeItem({ name: 'Mine' }, other);
    as(alice);

    const res = await create(
      { name: 'Drill', sourceItemId: drill._id.toString(), linkItems: [mine._id.toString()] },
      other
    );

    expect(res.status).toBe(201);
    expect((await res.json()).data.relatedItems).toEqual([]);
    expect(await stored(mine._id)).toEqual([]);
  });
});

describe('the cap of 10, on both sides', () => {
  it('refuses an item an 11th partner', async () => {
    const hub = await makeItem({ name: 'Hub' });
    const ten = await Promise.all(Array.from({ length: ITEM_LINKS_MAX }, () => makeItem()));
    for (const item of ten) await linkDirectly(hub, item);
    const extra = await makeItem({ name: 'Extra' });
    as(alice);

    const res = await patch(hub._id.toString(), { linkItems: [extra._id.toString()] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(LINK_CAP_ERROR);
    expect(await stored(extra._id)).toEqual([]);

    // Swapping one out for it in the same edit is fine.
    const swap = await patch(hub._id.toString(), {
      unlinkItems: [ten[0]._id.toString()],
      linkItems: [extra._id.toString()],
    });
    expect(swap.status).toBe(200);
    expect((await stored(hub._id)).length).toBe(ITEM_LINKS_MAX);
    expect(await stored(ten[0]._id)).toEqual([]);
  });

  it('refuses linking to a partner that already has 10, naming it', async () => {
    const full = await makeItem({ name: 'Full' });
    for (let i = 0; i < ITEM_LINKS_MAX; i++) await linkDirectly(full, await makeItem());
    const item = await makeItem({ name: 'New' });
    as(alice);

    const res = await patch(item._id.toString(), { linkItems: [full._id.toString()] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(partnerCapError('Full'));
    expect(await stored(item._id)).toEqual([]);
  });

  it('holds the partner’s cap when two links to it race past the check', async () => {
    // regression: a cap checked only before the write let two requests each see
    // room for one more and both write, leaving the partner with 11.
    const hub = await makeItem({ name: 'Hub' });
    for (let i = 0; i < ITEM_LINKS_MAX - 1; i++) await linkDirectly(hub, await makeItem());
    const first = await makeItem({ name: 'First' });
    const second = await makeItem({ name: 'Second' });
    as(alice);

    // `first`'s request is held at its first write, after its check passed,
    // while `second`'s runs whole and takes the hub's last place.
    let secondStatus = 0;
    const race = holdFirstCall(Item, 'updateOne', async () => {
      secondStatus = (await patch(second._id.toString(), { linkItems: [hub._id.toString()] }))
        .status;
    });
    const res = await patch(first._id.toString(), { linkItems: [hub._id.toString()] });

    expect(race.held()).toBe(true);
    expect(secondStatus).toBe(200);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(partnerCapError('Hub'));
    expect((await stored(hub._id)).length).toBe(ITEM_LINKS_MAX);
    expect(await stored(hub._id)).toContain(second._id.toString());
    // Taken back off the item it was refused for.
    expect(await stored(first._id)).toEqual([]);
  });

  it('never leaves a partner more than 10 when many links to it race', async () => {
    const hub = await makeItem({ name: 'Hub' });
    const items = await Promise.all(Array.from({ length: ITEM_LINKS_MAX + 3 }, () => makeItem()));
    as(alice);

    const statuses = await Promise.all(
      items.map(
        async (item) =>
          (await patch(item._id.toString(), { linkItems: [hub._id.toString()] })).status
      )
    );

    const hubLinks = await stored(hub._id);
    expect(hubLinks.length).toBeLessThanOrEqual(ITEM_LINKS_MAX);
    // Every link that stands stands on both sides, and every refused item holds none.
    for (const [i, item] of items.entries()) {
      const linked = hubLinks.includes(item._id.toString());
      expect(await stored(item._id)).toEqual(linked ? [hub._id.toString()] : []);
      if (!linked) expect(statuses[i]).not.toBe(200);
    }
  });
});

describe('review fixes', () => {
  it('answers a retried create with the item its first attempt linked, even when that filled the partner', async () => {
    // regression: the link check ran before the retry was recognised, so the
    // partner's 10th link (the first attempt's own item) refused the retry.
    const hub = await makeItem({ name: 'Hub' });
    for (let i = 0; i < ITEM_LINKS_MAX - 1; i++) await linkDirectly(hub, await makeItem());
    as(alice);
    const key = 'create-key-0123456789abcdef';

    const first = await create({ name: 'New', linkItems: [hub._id.toString()] }, list, key);
    expect(first.status).toBe(201);
    const made = (await first.json()).data;

    const retry = await create({ name: 'New', linkItems: [hub._id.toString()] }, list, key);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data._id).toBe(made._id);
    expect(await Item.countDocuments({ name: 'New' })).toBe(1);
  });

  it('writes nothing of an edit whose own links are refused when it lands', async () => {
    // regression: removals were written before the conditional add, and the
    // content before the links, so a refused edit half-applied.
    const hub = await makeItem({ name: 'Hub' });
    const old = await makeItem({ name: 'Old' });
    await linkDirectly(hub, old);
    for (let i = 0; i < ITEM_LINKS_MAX - 2; i++) await linkDirectly(hub, await makeItem());
    const b = await makeItem({ name: 'B' });
    const c = await makeItem({ name: 'C' });
    const late = await makeItem({ name: 'Late' });
    as(alice);

    // Passes the check at 9 - 1 + 2 = 10; a link landing meanwhile makes it 11.
    holdFirstCall(Item, 'updateOne', () => linkDirectly(hub, late));
    const res = await patch(hub._id.toString(), {
      name: 'Hub 2',
      unlinkItems: [old._id.toString()],
      linkItems: [b._id.toString(), c._id.toString()],
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LINK_CAP_ERROR);
    const after = await Item.findById(hub._id).lean();
    expect(after?.name).toBe('Hub');
    expect(await stored(hub._id)).toContain(old._id.toString());
    expect(await stored(old._id)).toEqual([hub._id.toString()]);
    expect(await stored(b._id)).toEqual([]);
  });

  it('clears a one-sided link nobody can see, so it never holds a place under the cap', async () => {
    const hub = await makeItem({ name: 'Hub' });
    for (let i = 0; i < ITEM_LINKS_MAX - 1; i++) await linkDirectly(hub, await makeItem());
    const halfGone = await makeItem({ name: 'Half' });
    // Recorded on the hub only: shown to nobody.
    await Item.updateOne({ _id: hub._id }, { $addToSet: { relatedItems: halfGone._id } });
    const extra = await makeItem({ name: 'Extra' });
    as(alice);

    const res = await patch(hub._id.toString(), { linkItems: [extra._id.toString()] });

    expect(res.status).toBe(200);
    const hubLinks = await stored(hub._id);
    expect(hubLinks).toHaveLength(ITEM_LINKS_MAX);
    expect(hubLinks).toContain(extra._id.toString());
    expect(hubLinks).not.toContain(halfGone._id.toString());
  });
});

describe('cleanup', () => {
  it('takes a deleted item off its partners', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    const case_ = await makeItem({ name: 'Case' });
    await linkDirectly(drill, bits);
    await linkDirectly(drill, case_);
    as(alice);

    expect((await remove(drill._id.toString())).status).toBe(200);

    expect(await stored(bits._id)).toEqual([]);
    expect(await stored(case_._id)).toEqual([]);
  });

  it('leaves no link to a partner deleted while the link was being written', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    as(alice);

    holdFirstCall(Item, 'updateOne', async () => {
      await remove(bits._id.toString());
    });
    const res = await patch(drill._id.toString(), { linkItems: [bits._id.toString()] });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LINK_TARGET_ERROR);
    expect(await stored(drill._id)).toEqual([]);
  });

  it('takes the item off its partner when it’s deleted after its own side was written', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    as(alice);

    // The item's own write lands, then it's deleted (its unlink finds no
    // partner yet), then the partner takes it: the re-check takes it back off.
    holdFirstCall(
      Item,
      'updateOne',
      async () => {
        await remove(drill._id.toString());
      },
      { after: true }
    );
    const res = await patch(drill._id.toString(), { linkItems: [bits._id.toString()] });

    expect(res.status).toBe(404);
    expect(await stored(bits._id)).toEqual([]);
  });

  it('ignores a dangling or one-sided link when read', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    await Item.updateOne(
      { _id: drill._id },
      { $set: { relatedItems: [new mongoose.Types.ObjectId(), bits._id] } }
    );

    const read = await readAs(alice);

    expect(read.get('Drill')?.relatedItems).toEqual([]);
    expect(read.get('Bits')?.relatedItems).toEqual([]);
  });
});

describe('what each viewer sees', () => {
  it('shows a draft partner to owners only, and a proposal to nobody', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const draft = await makeItem({ name: 'Case', status: 'draft' });
    const bits = await makeItem({ name: 'Bits' });
    const proposal = await makeItem({ name: 'Gloves', status: 'proposed', proposedBy: carol });
    await linkDirectly(drill, draft);
    await linkDirectly(drill, bits);
    // A proposal can't be linked through the API; one recorded anyway never shows.
    await linkDirectly(drill, proposal);

    const ownerView = await readAs(alice);
    expect(ownerView.get('Drill')?.relatedItems.map((r) => r.name)).toEqual(['Case', 'Bits']);
    expect(ownerView.get('Gloves')?.relatedItems).toEqual([]);

    for (const viewer of [carol, erin, null]) {
      const view = await readAs(viewer);
      expect(view.get('Drill')?.relatedItems.map((r) => r.name)).toEqual(['Bits']);
      expect(view.has('Case')).toBe(false);
    }
    // Not even to the proposer of the proposal.
    expect((await readAs(carol)).get('Gloves')?.relatedItems).toEqual([]);
  });

  it('carries only { id, name } per partner, the same whether it’s reserved or not', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits', status: 'booked', bookedBy: carol });
    const case_ = await makeItem({ name: 'Case' });
    await linkDirectly(drill, bits);
    await linkDirectly(drill, case_);

    for (const viewer of [alice, carol, erin]) {
      const chips = (await readAs(viewer)).get('Drill')?.relatedItems ?? [];
      expect(chips).toEqual([
        { id: bits._id.toString(), name: 'Bits' },
        { id: case_._id.toString(), name: 'Case' },
      ]);
    }

    // The owner's edit answer says no more.
    as(alice);
    const { data } = await (await patch(drill._id.toString(), { notes: 'Cordless' })).json();
    expect(data.relatedItems).toEqual([
      { id: bits._id.toString(), name: 'Bits' },
      { id: case_._id.toString(), name: 'Case' },
    ]);
  });
});

describe('booking stays independent', () => {
  it('reserving and releasing one item leaves its partner untouched', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits' });
    await linkDirectly(drill, bits);
    const before = await Item.findById(bits._id).lean();
    as(carol);

    const booked = await patch(drill._id.toString(), { status: 'booked' });
    expect(booked.status).toBe(200);
    expect((await booked.json()).data.relatedItems).toEqual([
      { id: bits._id.toString(), name: 'Bits' },
    ]);
    expect(await Reservation.countDocuments({ item: bits._id })).toBe(0);
    expect(await patch(drill._id.toString(), { status: 'available' })).toHaveProperty(
      'status',
      200
    );

    const after = await Item.findById(bits._id).lean();
    expect(after?.status).toBe('available');
    expect(after?.bookedBy ?? null).toBeNull();
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    expect(await stored(bits._id)).toEqual([drill._id.toString()]);
  });
});

describe('copying a whole list (/copy)', () => {
  it('remaps links between copied items and drops links to items left out', async () => {
    const drill = await makeItem({ name: 'Drill' });
    const bits = await makeItem({ name: 'Bits', status: 'draft' });
    const case_ = await makeItem({ name: 'Case' });
    await linkDirectly(drill, bits);
    await linkDirectly(drill, case_);
    as(alice);

    const res = await COPY_LIST(
      new NextRequest(`http://localhost/api/wishlists/${list}/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'copy-key-0123456789ab' },
        body: JSON.stringify({
          name: 'Tools 2',
          visibility: 'everyone',
          itemIds: [drill._id, bits._id].map(String),
        }),
      }),
      params(list)
    );

    expect(res.status).toBe(201);
    const { data } = await res.json();
    const copies = await Item.find({ wishlist: data._id }).lean();
    const byName = new Map(copies.map((c) => [c.name, c]));
    expect(copies).toHaveLength(2);
    expect((byName.get('Drill')?.relatedItems ?? []).map(String)).toEqual([
      String(byName.get('Bits')?._id),
    ]);
    expect((byName.get('Bits')?.relatedItems ?? []).map(String)).toEqual([
      String(byName.get('Drill')?._id),
    ]);
    // The source's links are untouched.
    expect(await stored(drill._id)).toEqual([bits._id.toString(), case_._id.toString()].sort());
  });
});
