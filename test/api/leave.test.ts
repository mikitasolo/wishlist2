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
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

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
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'everyone' });
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
    // `Reservation.owner` is the gift *recipient* snapshot, not a wishlist owner set.
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

  // regression: leaving logged `Unbooked <n> item(s) for user <id> in wishlist <id>`,
  // and a failed invite-notification cleanup on the way named the list too. That
  // put who left which list, and how much of it they had booked, in the server log.
  it.each(['member', 'co-owner'] as const)(
    'regression: a %s leaving logs no user id, wishlist id or booking count',
    async (role) => {
      const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      try {
        const owner = (await Wishlist.findById(wishlistId))!.owners[0];
        if (role === 'co-owner') {
          // The other branch of the route: an owner stepping down.
          await WishlistMember.deleteOne({ wishlist: wishlistId, user: memberId });
          await Wishlist.updateOne({ _id: wishlistId }, { $push: { owners: memberId } });
        }
        // A second booking, so there's a count worth hiding.
        await Item.create({
          wishlist: wishlistId,
          name: 'Gift 2',
          status: 'booked',
          bookedBy: memberId,
        });
        // A pending invite, which leaving cancels. Its notification cleanup then
        // fails, so the one best-effort log line on this path fires too.
        await WishlistInvite.create({
          wishlist: wishlistId,
          invitedBy: owner,
          invitedUser: memberId,
          role: 'owner',
        });
        vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db down'));

        session.mockResolvedValue({ user: { id: memberId } } as never);
        const res = await DELETE(
          new NextRequest('http://localhost/api/wishlists/' + wishlistId + '/members/me', {
            method: 'DELETE',
          }),
          { params: Promise.resolve({ id: wishlistId }) }
        );
        expect(res.status).toBe(200);
        const count = (await res.json()).data.unbookedItemsCount;
        expect(count).toBe(2);

        const calls = spies.flatMap((spy) => spy.mock.calls);
        expect(calls.length).toBeGreaterThan(0); // the cleanup failure was logged
        // An error's message and own properties (where Mongo puts `keyValue`), not
        // its stack, which is code locations only.
        const logged = calls
          .flat()
          .map((arg) =>
            arg instanceof Error ? `${arg.message} ${JSON.stringify(arg)}` : String(arg)
          )
          .join('\n');
        expect(logged).not.toContain(memberId);
        expect(logged).not.toContain(wishlistId);
        expect(logged).not.toMatch(new RegExp(`\\b${count}\\b`));
      } finally {
        vi.restoreAllMocks();
      }
    }
  );
});
