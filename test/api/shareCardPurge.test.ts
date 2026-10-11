import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const { deleteByTag } = vi.hoisted(() => ({ deleteByTag: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));
// Don't hit the DB/external API for currency rates.
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as patchWishlist, DELETE as deleteWishlist } from '@/app/api/wishlists/[id]/route';
import {
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import { PATCH as patchMe } from '@/app/api/users/me/route';
import { POST as createItem } from '@/app/api/wishlists/[id]/items/route';
import { PATCH as patchItem, DELETE as deleteItem } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

/**
 * Vercel's CDN keeps a share card for a day (lib/og/shareCards.ts), so every
 * write that changes what one shows drops it, once the write has landed: a
 * purge that ran first could be refilled from the old data before the write.
 * A write that changes nothing a card shows, or that's refused, purges nothing.
 */

const session = vi.mocked(auth);
let alice: string;
let bob: string;
let listId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  deleteByTag.mockReset();
  deleteByTag.mockResolvedValue(undefined);
  alice = (await User.create({ email: 'alice@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'bob@x.com', username: 'bob' }))._id.toString();
  listId = (
    await Wishlist.create({
      name: 'Birthday',
      owners: [alice, bob],
      visibility: 'everyone',
      slug: 'birthday-ab12c',
      bannerUrl: 'https://example.com/old-banner.jpg',
    })
  )._id.toString();
});

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function patchList(body: Record<string, unknown>) {
  return patchWishlist(req(`/api/wishlists/${listId}`, 'PATCH', body), {
    params: Promise.resolve({ id: listId }),
  });
}

/** The tags each purge was asked for. */
const purged = () => deleteByTag.mock.calls.map(([tags]) => tags);

describe('PATCH /api/wishlists/[id]', () => {
  it.each([
    ['name', { name: 'Renamed' }],
    ['URL', { slug: 'new-url' }],
    ['visibility', { visibility: 'private' }],
    ['archived flag', { archived: true }],
    ['banner', { bannerUrl: 'https://example.com/banner.jpg' }],
    ['banner, cleared', { bannerUrl: null }],
    // regression: WIS-428, the card's cover pattern is picked by the occasion's kind
    ['occasion', { occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' } }],
  ])("purges the list's card when its %s changes", async (_, body) => {
    as(alice);
    const res = await patchList(body);
    expect(res.status).toBe(200);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it('purges only once the change has landed', async () => {
    let seen: string | undefined;
    deleteByTag.mockImplementation(async () => {
      seen = (await Wishlist.findById(listId).lean())?.visibility;
    });
    as(alice);
    await patchList({ visibility: 'private' });
    expect(seen).toBe('private');
  });

  it.each([
    ['description', { description: 'Things I like' }],
    ['currency', { currency: 'EUR' }],
    ['pin', { featured: true }],
  ])('leaves the card alone when only the %s changes', async (_, body) => {
    as(alice);
    const res = await patchList(body);
    expect(res.status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it('purges nothing for a refused edit', async () => {
    const carol = (await User.create({ email: 'carol@x.com', username: 'carol' }))._id;
    as(carol.toString());
    const res = await patchList({ visibility: 'private' });
    expect(res.status).toBe(403);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  // Best-effort: the write has landed, and the card's one-day TTL bounds it.
  it('still saves when the purge fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteByTag.mockRejectedValue(new Error('purge down'));
    as(alice);
    const res = await patchList({ visibility: 'private' });
    expect(res.status).toBe(200);
    expect((await Wishlist.findById(listId).lean())?.visibility).toBe('private');
  });
});

describe('DELETE /api/wishlists/[id]', () => {
  it("purges the deleted list's card", async () => {
    as(alice);
    const res = await deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), {
      params: Promise.resolve({ id: listId }),
    });
    expect(res.status).toBe(200);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it('purges nothing when the delete is refused', async () => {
    const carol = (await User.create({ email: 'carol@x.com', username: 'carol' }))._id;
    as(carol.toString());
    const res = await deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), {
      params: Promise.resolve({ id: listId }),
    });
    expect(res.status).toBe(403);
    expect(deleteByTag).not.toHaveBeenCalled();
  });
});

// The card credits the list's primary owner (owners[0]), who may be the one
// going. Alice is the primary owner here.
describe('an owner going', () => {
  it.each([
    [
      'removed',
      () =>
        removeOwner(req(`/api/wishlists/${listId}/owners/${alice}`, 'DELETE'), {
          params: Promise.resolve({ id: listId, userId: alice }),
        }),
      () => as(bob),
    ],
    [
      'demoted',
      () =>
        demote(req(`/api/wishlists/${listId}/owners/${alice}`, 'PATCH'), {
          params: Promise.resolve({ id: listId, userId: alice }),
        }),
      () => as(bob),
    ],
    [
      'leaving',
      () =>
        leave(req(`/api/wishlists/${listId}/members/me`, 'DELETE'), {
          params: Promise.resolve({ id: listId }),
        }),
      () => as(alice),
    ],
  ])("purges the list's card when its primary owner is %s", async (_, send, signIn) => {
    signIn();
    const res = await send();
    expect(res.status).toBe(200);
    expect((await Wishlist.findById(listId).lean())?.owners.map(String)).toEqual([bob]);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it('purges nothing when the last owner may not go', async () => {
    await Wishlist.updateOne(
      { _id: listId },
      { $set: { owners: [new mongoose.Types.ObjectId(alice)] } }
    );
    as(alice);
    const res = await leave(req(`/api/wishlists/${listId}/members/me`, 'DELETE'), {
      params: Promise.resolve({ id: listId }),
    });
    expect(res.status).toBe(400);
    expect(deleteByTag).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/users/me', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function patchProfile(body: Record<string, unknown>) {
    as(alice);
    return patchMe(req('/api/users/me', 'PATCH', body));
  }

  /** Have another tab's save land just after the request has read the profile. */
  function landAfterRead(change: Record<string, unknown>) {
    const findById = User.findById.bind(User);
    vi.spyOn(User, 'findById').mockImplementationOnce(((id: string) =>
      findById(id).then(async (user) => {
        await User.updateOne({ _id: id }, { $set: change });
        return user;
      })) as never);
  }

  // Their profile card, and the cards of the lists they're primary owner of,
  // which carry the same tag.
  it.each([
    ['username', { username: 'alice2' }],
    ['bio', { bio: 'Collector of mugs' }],
    ['avatar', { image: 'https://example.com/me.jpg' }],
    ['profile visibility', { privacy: { profileVisibility: 'friends' } }],
  ])("purges the user's cards when their %s changes", async (_, body) => {
    const res = await patchProfile(body);
    expect(res.status).toBe(200);
    expect(purged()).toEqual([[`og-user-${alice}`]]);
  });

  it('purges only once the change has landed', async () => {
    let seen: string | null | undefined;
    deleteByTag.mockImplementation(async () => {
      seen = (await User.findById(alice).lean())?.username;
    });
    await patchProfile({ username: 'alice2' });
    expect(seen).toBe('alice2');
  });

  it('leaves the cards alone when only the default currency changes', async () => {
    const res = await patchProfile({ defaultCurrency: 'EUR' });
    expect(res.status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  // A tab still running the previous settings page sends the bio and every
  // privacy setting with each save.
  it("leaves the cards alone when the form's save changes nothing they show", async () => {
    await User.updateOne({ _id: alice }, { $set: { bio: 'Collector of mugs' } });
    const res = await patchProfile({
      bio: 'Collector of mugs',
      defaultCurrency: 'EUR',
      privacy: { searchable: false, whoCanInvite: 'friends', profileVisibility: 'everyone' },
    });
    expect(res.status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  // regression: the route compared what it wrote with its own read, so when
  // another tab's save landed between the two, a write that put the card back
  // the way that read saw it looked like no change: the card cached after the
  // other tab's save (showing the bio, or the old one) stayed up for a day.
  it.each([
    [
      'profile visibility',
      { 'privacy.profileVisibility': 'everyone' },
      { privacy: { profileVisibility: 'friends' } },
    ],
    ['bio', { bio: 'Collector of plants' }, { bio: 'Collector of mugs' }],
  ])(
    'regression: purges when its %s write changes what another tab saved after the read',
    async (_, theirs, ours) => {
      await User.updateOne(
        { _id: alice },
        { $set: { bio: 'Collector of mugs', 'privacy.profileVisibility': 'friends' } }
      );
      landAfterRead(theirs);

      const res = await patchProfile(ours);

      expect(res.status).toBe(200);
      expect(purged()).toEqual([[`og-user-${alice}`]]);
    }
  );

  it('leaves the cards alone when another tab already saved the same change', async () => {
    landAfterRead({ 'privacy.profileVisibility': 'friends' });

    const res = await patchProfile({ privacy: { profileVisibility: 'friends' } });

    expect(res.status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });
});

// The list's card shows how many items a visitor sees (not drafts or proposals).
describe('item writes', () => {
  let carol: string;

  beforeEach(async () => {
    carol = (await User.create({ email: 'carol@x.com', username: 'carol' }))._id.toString();
    await WishlistMember.create({ wishlist: listId, user: carol });
  });

  function create(body: Record<string, unknown>) {
    return createItem(req(`/api/wishlists/${listId}/items`, 'POST', body), {
      params: Promise.resolve({ id: listId }),
    });
  }
  function patch(id: string, body: Record<string, unknown>) {
    return patchItem(req(`/api/items/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) });
  }
  function remove(id: string) {
    return deleteItem(req(`/api/items/${id}`, 'DELETE'), { params: Promise.resolve({ id }) });
  }
  async function item(fields: Record<string, unknown>) {
    return (await Item.create({ wishlist: listId, name: 'Lamp', ...fields }))._id.toString();
  }

  it("purges the list's card when an owner adds an item", async () => {
    as(alice);
    expect((await create({ name: 'Lamp' })).status).toBe(201);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it.each([
    ['a draft', () => as(alice), { name: 'Lamp', status: 'draft' }],
    ['a proposal', () => as(carol), { name: 'Lamp', status: 'proposed' }],
  ])('leaves the card alone when %s is added', async (_, signIn, body) => {
    signIn();
    expect((await create(body)).status).toBe(201);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it.each([
    ['publishes a draft', () => ({ status: 'draft' }), { status: 'available' }],
    ['moves an item to drafts', () => ({ status: 'available' }), { status: 'draft' }],
    [
      'approves a proposal',
      () => ({ status: 'proposed', proposedBy: carol }),
      { status: 'available' },
    ],
  ])("purges the list's card when an owner %s", async (_, fields, body) => {
    const id = await item(fields());
    as(alice);
    expect((await patch(id, body)).status).toBe(200);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it("leaves the card alone when a member books or an owner edits an item's content", async () => {
    const id = await item({ status: 'available' });
    as(carol);
    expect((await patch(id, { status: 'booked' })).status).toBe(200);
    as(alice);
    expect((await patch(id, { name: 'Desk lamp' })).status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it("purges the list's card when a visible item is deleted, not a draft", async () => {
    const draft = await item({ status: 'draft' });
    const visible = await item({ status: 'available' });
    as(alice);
    expect((await remove(draft)).status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
    expect((await remove(visible)).status).toBe(200);
    expect(purged()).toEqual([[`og-wishlist-${listId}`]]);
  });

  it('leaves the card alone when a proposer withdraws their proposal', async () => {
    const id = await item({ status: 'proposed', proposedBy: carol });
    as(carol);
    expect((await remove(id)).status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();
  });
});
