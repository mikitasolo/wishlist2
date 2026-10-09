import { expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { POST as startRoute } from '@/app/api/items/[id]/group-gift/route';
import {
  PUT as pledgeRoute,
  DELETE as leaveGiftRoute,
} from '@/app/api/items/[id]/group-gift/me/route';
import { POST as cancelRoute } from '@/app/api/items/[id]/group-gift/cancel/route';
import { POST as convertRoute } from '@/app/api/items/[id]/group-gift/convert/route';
import { POST as givenRoute } from '@/app/api/items/[id]/group-gift/given/route';
import { GET as getItems } from '@/app/api/wishlists/[id]/items/route';
import { PATCH as patchItem, DELETE as deleteItem } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import GroupGift from '@/models/GroupGift';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';

/**
 * Shared set-up for the group gift API tests (WIS-361). Not a test file
 * (Vitest picks up only `*.test.ts`): each test file mocks `@/lib/mongodb` and
 * `@/lib/auth` itself, at its top, before importing this.
 */

export const session = vi.mocked(auth);

/** The next `auth()` call answers as `user` (or signed out, for null). */
export function as(user: string | null) {
  session.mockResolvedValueOnce((user ? { user: { id: user } } : null) as never);
}

export const json = (url: string, method: string, body?: unknown, headers?: HeadersInit) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const p = (id: string) => ({ params: Promise.resolve({ id }) });

export interface World {
  owner: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string; // not on the list
  wishlistId: string;
  itemId: string;
  membership: Record<'alice' | 'bob' | 'carol', string>;
}

/** An owner, three members (alice, bob, carol), an outsider, and a $100 item. */
export async function seedWorld(): Promise<World> {
  const [o, a, b, c, d] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
    { email: 'c@x.com', username: 'carol' },
    { email: 'd@x.com', username: 'dave' },
  ]);
  const wl = await Wishlist.create({ name: 'Birthday', owners: [o._id], visibility: 'everyone' });
  const rows = await WishlistMember.create([
    { wishlist: wl._id, user: a._id },
    { wishlist: wl._id, user: b._id },
    { wishlist: wl._id, user: c._id },
  ]);
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Camera',
    price: { value: 10000, currency: 'USD' },
  });
  return {
    owner: o._id.toString(),
    alice: a._id.toString(),
    bob: b._id.toString(),
    carol: c._id.toString(),
    dave: d._id.toString(),
    wishlistId: wl._id.toString(),
    itemId: item._id.toString(),
    membership: {
      alice: rows[0]._id.toString(),
      bob: rows[1]._id.toString(),
      carol: rows[2]._id.toString(),
    },
  };
}

export function api(w: () => World) {
  const item = () => w().itemId;
  return {
    start(user: string, body: unknown = { pledged: 3000 }, headers?: HeadersInit) {
      as(user);
      return startRoute(json(`/api/items/${item()}/group-gift`, 'POST', body, headers), p(item()));
    },
    pledge(user: string, pledged: number) {
      as(user);
      return pledgeRoute(json(`/api/items/${item()}/group-gift/me`, 'PUT', { pledged }), p(item()));
    },
    leaveGift(user: string) {
      as(user);
      return leaveGiftRoute(json(`/api/items/${item()}/group-gift/me`, 'DELETE'), p(item()));
    },
    cancel(user: string, headers?: HeadersInit) {
      as(user);
      return cancelRoute(
        json(`/api/items/${item()}/group-gift/cancel`, 'POST', undefined, headers),
        p(item())
      );
    },
    convert(user: string, headers?: HeadersInit) {
      as(user);
      return convertRoute(
        json(`/api/items/${item()}/group-gift/convert`, 'POST', undefined, headers),
        p(item())
      );
    },
    give(user: string, headers?: HeadersInit) {
      as(user);
      return givenRoute(
        json(`/api/items/${item()}/group-gift/given`, 'POST', undefined, headers),
        p(item())
      );
    },
    readItems(user: string | null) {
      as(user);
      return getItems(json(`/api/wishlists/${w().wishlistId}/items`, 'GET'), p(w().wishlistId));
    },
    patchItem(user: string, body: unknown) {
      as(user);
      return patchItem(json(`/api/items/${item()}`, 'PATCH', body), p(item()));
    },
    deleteItem(user: string) {
      as(user);
      return deleteItem(json(`/api/items/${item()}`, 'DELETE'), p(item()));
    },
  };
}

export async function liveGift(itemId: string) {
  return GroupGift.findOne({ item: itemId, active: true }).lean();
}

/**
 * "A booking is never left where nobody can release it", for every booked item
 * on the list: held by a member who isn't an owner, and a group gift's item by
 * the organizer of its live gift, whose contributors are all such members.
 */
export async function expectEveryBookingReleasable(wishlistId: string) {
  const list = await Wishlist.findById(wishlistId).lean();
  const isPlainMember = async (id: string) =>
    !!list &&
    !isWishlistOwner(list, id) &&
    !!(await WishlistMember.exists({ wishlist: wishlistId, user: id }));
  const booked = await Item.find({ wishlist: wishlistId, status: 'booked' }).lean();
  for (const item of booked) {
    expect(item.bookedBy, `item ${item.name} has no holder`).toBeTruthy();
    expect(await isPlainMember(item.bookedBy!.toString())).toBe(true);
    if (item.groupGift) {
      const gift = await GroupGift.findOne({ _id: item.groupGift, active: true }).lean();
      expect(gift, 'a group gift item holds a live gift').toBeTruthy();
      expect(gift!.organizer.toString()).toBe(item.bookedBy!.toString());
      for (const c of gift!.contributors) expect(await isPlainMember(c.user.toString())).toBe(true);
    }
  }
  // And no live gift whose item doesn't hold it.
  const gifts = await GroupGift.find({ wishlist: wishlistId, active: true }).lean();
  for (const gift of gifts) {
    const item = await Item.findById(gift.item).lean();
    expect(item?.groupGift?.toString()).toBe(gift._id.toString());
  }
}
