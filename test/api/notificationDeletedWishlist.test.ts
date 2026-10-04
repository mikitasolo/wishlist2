import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn().mockReturnValue(null),
}));

import { auth } from '@/lib/auth';
import { DELETE as deleteWishlist } from '@/app/api/wishlists/[id]/route';
import { POST as postItem } from '@/app/api/wishlists/[id]/items/route';
import { createNotification, createNotifications } from '@/lib/notifications';
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/utils/notifications';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';
import Item from '@/models/Item';

const session = vi.mocked(auth);

let rita: string; // owns the list
let otto: string; // co-owns it
let mia: string; // a member
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  rita = (await User.create({ email: 'rita@x.com', username: 'rita' }))._id.toString();
  otto = (await User.create({ email: 'otto@x.com', username: 'otto' }))._id.toString();
  mia = (await User.create({ email: 'mia@x.com', username: 'mia' }))._id.toString();
  wishlistId = (
    await Wishlist.create({ name: 'Trip', slug: 'trip', owners: [rita, otto] })
  )._id.toString();
  await WishlistMember.create({ wishlist: wishlistId, user: mia });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** An owner deletes the list through the route, cleanup and all. */
function deleteList() {
  session.mockResolvedValueOnce({ user: { id: rita } } as never);
  return deleteWishlist(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: wishlistId }) }
  );
}

const listNotifications = () => Notification.countDocuments({ wishlist: wishlistId });

// Every type that carries a list: all but a follow. A proposal is the one written
// as a coalescing upsert; the rest are plain inserts.
const LIST_TYPES = NOTIFICATION_TYPES.filter((type) => type !== 'follow');
const writeMethod = (type: NotificationType) =>
  type === 'proposal' ? 'findOneAndUpdate' : 'create';

function notify(type: NotificationType, user = mia) {
  return createNotification({
    user,
    type,
    wishlist: wishlistId,
    wishlistName: 'Trip',
    wishlistSlug: 'trip',
    itemName: 'Tent',
  });
}

describe('a notification about a list deleted while it is being written', () => {
  it.each(LIST_TYPES)('keeps a %s notification for a list that still exists', async (type) => {
    await notify(type);

    expect(await Notification.countDocuments({ user: mia, type, wishlist: wishlistId })).toBe(1);
  });

  // regression: the delete removes the list and then its notifications, so a writer
  // already past its own checks wrote this one after that cleanup had run, and it
  // outlived the list as a link to a 404.
  it.each(LIST_TYPES)(
    'regression: drops a %s notification when the delete lands just before it is written',
    async (type) => {
      const race = holdFirstCall(Notification, writeMethod(type), deleteList);

      await notify(type);

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(await Wishlist.exists({ _id: wishlistId })).toBeNull();
      expect(await listNotifications()).toBe(0);
    }
  );

  // The other half of what the re-check relies on: a delete removes the list before
  // its notifications. So a row whose list is still there at the re-check is kept,
  // and the delete that lands just after takes it with its own cleanup.
  it('leaves nothing either when the delete lands just after the re-check found the list', async () => {
    const race = holdFirstCall(Wishlist, 'exists', deleteList, { after: true });

    await notify('invite_accepted');

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(await listNotifications()).toBe(0);
  });

  // regression: as above, through a real writer that fans out to every owner.
  it('regression: a proposal made as the list is deleted leaves no notification for any owner', async () => {
    const race = holdFirstCall(Notification, 'findOneAndUpdate', deleteList);

    session.mockResolvedValueOnce({ user: { id: mia, username: 'mia' } } as never);
    const res = await postItem(
      new NextRequest(`http://localhost/api/wishlists/${wishlistId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tent', status: 'proposed' }),
      }),
      { params: Promise.resolve({ id: wishlistId }) }
    );

    expect(res.status).toBe(201);
    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(await Item.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await Notification.countDocuments({ user: { $in: [rita, otto] } })).toBe(0);
    expect(await listNotifications()).toBe(0);
  });

  it('re-checks the list once for a whole fan-out, and keeps every row while it exists', async () => {
    const exists = vi.spyOn(Wishlist, 'exists');

    await createNotifications([rita, otto, rita], {
      type: 'proposal',
      wishlist: wishlistId,
      wishlistName: 'Trip',
      itemName: 'Tent',
    });

    expect(exists).toHaveBeenCalledTimes(1);
    expect(await Notification.countDocuments({ type: 'proposal', wishlist: wishlistId })).toBe(2);
  });

  it('drops every row of a fan-out whose list is gone', async () => {
    const race = holdFirstCall(Notification, 'findOneAndUpdate', deleteList);

    await createNotifications([rita, otto], {
      type: 'proposal',
      wishlist: wishlistId,
      wishlistName: 'Trip',
      itemName: 'Tent',
    });

    expect(race.held()).toBe(true);
    expect(await listNotifications()).toBe(0);
  });

  it('only takes back the rows it wrote, not other notifications of the recipient', async () => {
    const other = await Wishlist.create({ name: 'Home', owners: [otto] });
    await createNotification({
      user: mia,
      type: 'wishlist_invite',
      wishlist: other._id,
      wishlistName: 'Home',
    });
    await createNotification({ user: mia, type: 'follow', actorUsername: 'otto' });
    const race = holdFirstCall(Notification, 'create', deleteList);

    await notify('proposal_approved');

    expect(race.held()).toBe(true);
    expect(await listNotifications()).toBe(0);
    const left = await Notification.find({ user: mia }).sort({ type: 1 });
    expect(left.map((n) => n.type)).toEqual(['follow', 'wishlist_invite']);
  });

  it('reads no list for a follow, which carries none', async () => {
    const exists = vi.spyOn(Wishlist, 'exists');

    await createNotification({ user: rita, type: 'follow', actorUsername: 'mia' });

    expect(exists).not.toHaveBeenCalled();
    expect(await Notification.countDocuments({ user: rita, type: 'follow' })).toBe(1);
  });

  // Best-effort, like the write: the caller's request must never fail on it, and the
  // log line carries the error's kind, never its message (which can quote a value).
  it.each([
    ['the re-check', () => vi.spyOn(Wishlist, 'exists'), true],
    ['the cleanup', () => vi.spyOn(Notification, 'deleteMany'), false],
  ] as const)(
    'keeps the notification and logs only the kind of error when %s fails',
    async (_step, spyOn, listExists) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (!listExists) await Wishlist.deleteOne({ _id: wishlistId });
      spyOn().mockRejectedValueOnce(new Error('db down near rita@x.com'));

      // Resolves (never throws), with the id of the row it kept.
      await expect(notify('role_changed')).resolves.toBeInstanceOf(mongoose.Types.ObjectId);

      expect(await listNotifications()).toBe(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('notification'), {
        name: 'Error',
        code: undefined,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('rita@x.com');
    }
  );

  it('logs only the kind of error when the write itself fails, and reads no list', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exists = vi.spyOn(Wishlist, 'exists');
    vi.spyOn(Notification, 'create').mockRejectedValueOnce(new Error(`bad user ${mia}`));

    await expect(notify('role_changed')).resolves.toBeNull();

    expect(await listNotifications()).toBe(0);
    expect(exists).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Failed to create notification:', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(mia);
  });
});
