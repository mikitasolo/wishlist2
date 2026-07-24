import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { DELETE } from '@/app/api/wishlists/[id]/members/me/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);

let memberId: string;
let wishlistId: string;
let itemId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const member = await User.create({ email: 'member@x.com', username: 'member' });
  memberId = member._id.toString();
  const wl = await Wishlist.create({ name: 'List', owner: owner._id, visibility: 'everyone' });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: member._id, role: 'member' });
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Gift',
    status: 'booked',
    bookedBy: member._id,
  });
  itemId = item._id.toString();
  await Reservation.create({
    gifter: member._id,
    wishlist: wl._id,
    item: item._id,
    owner: owner._id,
    itemName: 'Gift',
    wishlistName: 'List',
  });
});

describe('DELETE /api/wishlists/[id]/members/me (leave)', () => {
  it('removes membership and frees the member’s booked items', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const req = new NextRequest('http://localhost/api/wishlists/' + wishlistId + '/members/me', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: wishlistId }) });
    expect(res.status).toBe(200);

    expect(await WishlistMember.findOne({ wishlist: wishlistId, user: memberId })).toBeNull();
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
  });

  // Regression: leaving frees the live booking, but the gifter's durable
  // Reservation must survive so they can still log a gift they already gave.
  it('regression: the gifter’s Reservation survives leaving the wishlist', async () => {
    session.mockResolvedValue({ user: { id: memberId } } as never);
    const req = new NextRequest('http://localhost/api/wishlists/' + wishlistId + '/members/me', {
      method: 'DELETE',
    });
    await DELETE(req, { params: Promise.resolve({ id: wishlistId }) });
    expect(await Reservation.findOne({ gifter: memberId, item: itemId })).not.toBeNull();
  });
});
