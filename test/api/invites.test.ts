import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/invites/[inviteId]/route';
import { DELETE as cancelInvite } from '@/app/api/wishlists/[id]/invites/[inviteId]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import Item from '@/models/Item';

const session = vi.mocked(auth);

let ownerId: string;
let inviteeId: string;
let wishlistId: string;
let inviteId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const invitee = await User.create({ email: 'invitee@x.com', username: 'invitee' });
  ownerId = owner._id.toString();
  inviteeId = invitee._id.toString();
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'friends' });
  wishlistId = wl._id.toString();
  const inv = await WishlistInvite.create({
    wishlist: wl._id,
    invitedBy: owner._id,
    invitedUser: invitee._id,
    role: 'member',
    status: 'pending',
  });
  inviteId = inv._id.toString();
});

function respond(id: string, action: string, userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
  const req = new NextRequest('http://localhost/api/invites/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return PATCH(req, { params: Promise.resolve({ inviteId: id }) });
}

describe('PATCH /api/invites/[inviteId]', () => {
  it('accepting creates membership and marks the invite accepted', async () => {
    const res = await respond(inviteId, 'accept', inviteeId);
    expect(res.status).toBe(200);
    expect(await WishlistMember.findOne({ wishlist: wishlistId, user: inviteeId })).not.toBeNull();
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
  });

  it('declining marks it declined and creates no membership', async () => {
    const res = await respond(inviteId, 'decline', inviteeId);
    expect(res.status).toBe(200);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await WishlistMember.findOne({ wishlist: wishlistId, user: inviteeId })).toBeNull();
  });

  // Regression: matching is by invitedUser only now (email-fallback removed), so
  // a different user cannot act on someone else's invite.
  it('regression: a different user cannot accept the invite', async () => {
    const other = await User.create({ email: 'other@x.com', username: 'other' });
    const res = await respond(inviteId, 'accept', other._id.toString());
    expect(res.status).toBe(403);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
  });

  it('answers 404 and declines the invite when its list is gone', async () => {
    await Wishlist.deleteOne({ _id: wishlistId });

    const res = await respond(inviteId, 'accept', inviteeId);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no longer exists/i);

    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).toBeNull();
  });
});

// Accept and decline record the answer in one conditional write before anything
// is granted: whichever answer reaches the pending invite first is the one that
// counts, and the other matches nothing.
describe('PATCH /api/invites/[inviteId] claims the invite first', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const member = () => WishlistMember.exists({ wishlist: wishlistId, user: inviteeId });
  const acceptedNotifications = () =>
    Notification.countDocuments({ user: ownerId, type: 'invite_accepted' });

  // regression: accept recorded `accepted` only after granting the role, so a second
  // accept (another tab, a double click) that read the invite in between granted it
  // again, and the inviter was told twice.
  it('regression: of two accepts at once, one lets them in and the other gets a 404', async () => {
    const race = holdFirstCall(
      WishlistInvite,
      'findById',
      () => respond(inviteId, 'accept', inviteeId),
      { after: true }
    );

    const first = await respond(inviteId, 'accept', inviteeId);

    expect(race.outcome()?.status).toBe(200);
    expect(first.status).toBe(404);
    expect(await WishlistMember.countDocuments({ wishlist: wishlistId })).toBe(1);
    expect(await acceptedNotifications()).toBe(1);
  });

  // regression: an accept that read the invite before a decline landed went on to
  // let them in and overwrite the decline with `accepted`.
  it('regression: a decline that lands during an accept wins, and nobody joins', async () => {
    const race = holdFirstCall(
      WishlistInvite,
      'findById',
      () => respond(inviteId, 'decline', inviteeId),
      { after: true }
    );

    const accepted = await respond(inviteId, 'accept', inviteeId);

    expect(race.outcome()?.status).toBe(200);
    expect(accepted.status).toBe(404);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await member()).toBeNull();
    expect(await acceptedNotifications()).toBe(0);
  });

  it('an accept that lands during a decline wins, and the decline gets a 404', async () => {
    const race = holdFirstCall(
      WishlistInvite,
      'findById',
      () => respond(inviteId, 'accept', inviteeId),
      { after: true }
    );

    const declined = await respond(inviteId, 'decline', inviteeId);

    expect(race.outcome()?.status).toBe(200);
    expect(declined.status).toBe(404);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
    expect(await member()).not.toBeNull();
  });

  it('reopens the invite when granting the role fails, so accepting again works', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(WishlistMember, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db down'));

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(500);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
    expect(await member()).toBeNull();
    expect(await acceptedNotifications()).toBe(0);

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);
    expect(await member()).not.toBeNull();
  });

  it('puts a member back on the list when their promotion fails half-way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const membership = await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    // The membership row is taken, then the ownership write fails.
    vi.spyOn(Wishlist, 'updateOne').mockRejectedValueOnce(new Error('db down'));

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(500);

    // Back as they were: the same membership row, not an owner, invite still open.
    const restored = await WishlistMember.findOne({ wishlist: wishlistId, user: inviteeId });
    expect(restored?._id.toString()).toBe(membership._id.toString());
    expect(restored?.createdAt.getTime()).toBe(membership.createdAt.getTime());
    expect((await Wishlist.findById(wishlistId))!.owners.map(String)).toEqual([ownerId]);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);
    expect((await Wishlist.findById(wishlistId))!.owners.map(String)).toContain(inviteeId);
    expect(await member()).toBeNull();
  });

  it('keeps no membership row when the ownership write landed but still reported an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    // The write is applied, and then its acknowledgement is lost.
    const realUpdate = Wishlist.updateOne.bind(Wishlist) as (
      ...a: unknown[]
    ) => PromiseLike<unknown>;
    vi.spyOn(Wishlist, 'updateOne').mockImplementationOnce(((...args: unknown[]) =>
      realUpdate(...args).then(() => {
        throw new Error('timed out');
      })) as never);

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(500);

    // An owner, and an owner has no membership row.
    expect((await Wishlist.findById(wishlistId))!.owners.map(String)).toContain(inviteeId);
    expect(await member()).toBeNull();
    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);
    expect(await member()).toBeNull();
  });

  // Reopening a claim is only any use if accepting again finishes the job, which
  // here means releasing the bookings of someone who is an owner already.
  it('releases their bookings when a retry finds the promotion half done', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    const item = await Item.create({
      wishlist: wishlistId,
      name: 'Gift',
      status: 'booked',
      bookedBy: inviteeId,
    });
    // Ownership lands, then freeing the booking fails.
    vi.spyOn(Item, 'updateMany').mockRejectedValueOnce(new Error('db down'));

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(500);
    expect((await Wishlist.findById(wishlistId))!.owners.map(String)).toContain(inviteeId);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');

    const retry = await respond(inviteId, 'accept', inviteeId);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.releasedBookings).toBe(1);
    const freed = await Item.findById(item._id);
    expect(freed?.status).toBe('available');
    expect(freed?.bookedBy ?? null).toBeNull();
  });
});

describe('DELETE /api/wishlists/[id]/invites/[inviteId]', () => {
  let otherListId: string;
  let bystanderId: string;

  function cancel(id: string, userId: string, listId = wishlistId) {
    session.mockResolvedValue({ user: { id: userId } } as never);
    const req = new NextRequest(`http://localhost/api/wishlists/${listId}/invites/${id}`, {
      method: 'DELETE',
    });
    return cancelInvite(req, { params: Promise.resolve({ id: listId, inviteId: id }) });
  }

  /** The invitee's `wishlist_invite` notifications for the list the invite is on. */
  const inviteNotifications = () =>
    Notification.countDocuments({ user: inviteeId, wishlist: wishlistId, type: 'wishlist_invite' });

  beforeEach(async () => {
    const otherList = await Wishlist.create({ name: 'Other', owners: [ownerId] });
    otherListId = otherList._id.toString();
    const bystander = await User.create({ email: 'bystander@x.com', username: 'bystander' });
    bystanderId = bystander._id.toString();
    // The bystander has their own pending invite to the same list.
    await WishlistInvite.create({
      wishlist: wishlistId,
      invitedBy: ownerId,
      invitedUser: bystanderId,
      role: 'member',
    });
    // Sent a while before the cancel, as in real life (the route only clears
    // notifications from before it started).
    const createdAt = new Date(Date.now() - 60_000);
    await Notification.create(
      [
        // What issuing the invite under test left behind.
        { user: inviteeId, type: 'wishlist_invite', wishlist: wishlistId, wishlistName: 'List' },
        // The invitee's invite to another list, and their other notifications.
        { user: inviteeId, type: 'wishlist_invite', wishlist: otherListId, wishlistName: 'Other' },
        { user: inviteeId, type: 'proposal_approved', wishlist: wishlistId, wishlistName: 'List' },
        { user: inviteeId, type: 'follow', actorUsername: 'owner' },
        // Someone else's invite notification for the same list.
        { user: bystanderId, type: 'wishlist_invite', wishlist: wishlistId, wishlistName: 'List' },
      ].map((n) => ({ ...n, createdAt }))
    );
  });

  // regression: cancelling an invite deleted the WishlistInvite but left the
  // invitee's `wishlist_invite` notification, which still linked to /invites and
  // looked actionable although there was nothing left to accept.
  it("regression: removes the invitee's invite notification for that list", async () => {
    const res = await cancel(inviteId, ownerId);
    expect(res.status).toBe(200);

    expect(await WishlistInvite.findById(inviteId)).toBeNull();
    expect(await inviteNotifications()).toBe(0);
  });

  it("keeps the invitee's other notifications, and other people's", async () => {
    await cancel(inviteId, ownerId);

    const left = await Notification.find({ user: inviteeId }).lean();
    expect(left.map((n) => [n.type, n.wishlist?.toString() ?? null]).sort()).toEqual(
      [
        ['wishlist_invite', otherListId],
        ['proposal_approved', wishlistId],
        ['follow', null],
      ].sort()
    );
    expect(
      await Notification.countDocuments({
        user: bystanderId,
        wishlist: wishlistId,
        type: 'wishlist_invite',
      })
    ).toBe(1);
  });

  // regression: the cancel looked the invite up without a status filter, so an
  // owner whose invites panel still listed an invite the invitee had since
  // accepted got "Invitation cancelled" (the person stayed a member) and the
  // accepted row was erased.
  it('regression: refuses to cancel an accepted invite and keeps the row and membership', async () => {
    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);

    const res = await cancel(inviteId, ownerId);
    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);

    expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
    expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).not.toBeNull();
  });

  // Accept and decline keep the notification as history, so a stale cancel of an
  // invite that was already answered (the owner's invites panel lagging behind)
  // keeps it too, along with the row.
  it.each(['accepted', 'declined'])(
    'answers 409 and changes nothing when the invite was already %s',
    async (status) => {
      await WishlistInvite.updateOne({ _id: inviteId }, { status });

      expect((await cancel(inviteId, ownerId)).status).toBe(409);

      expect((await WishlistInvite.findById(inviteId))?.status).toBe(status);
      expect(await inviteNotifications()).toBe(1);
    }
  );

  // The owner learns how an invite went from the members list, not from here.
  it("doesn't say whether an answered invite was accepted or declined", async () => {
    await WishlistInvite.updateOne({ _id: inviteId }, { status: 'accepted' });
    const declined = await WishlistInvite.findOneAndUpdate(
      { wishlist: wishlistId, invitedUser: bystanderId },
      { status: 'declined' }
    ).orFail();

    const accepted = await cancel(inviteId, ownerId);
    const refused = await cancel(declined._id.toString(), ownerId);

    expect([accepted.status, refused.status]).toEqual([409, 409]);
    const body = await accepted.json();
    expect(await refused.json()).toEqual(body);
    expect(body).toEqual({ success: false, error: 'This invitation has already been answered.' });
  });

  // An accept that lands after the owner check but right before the delete runs
  // must not be erased: the pending check is part of the delete, not a read
  // before it.
  it('keeps an invite accepted just before the delete runs', async () => {
    const realDelete = WishlistInvite.findOneAndDelete.bind(WishlistInvite);
    const racing = vi
      .spyOn(WishlistInvite, 'findOneAndDelete')
      .mockImplementationOnce(((filter: object) =>
        respond(inviteId, 'accept', inviteeId).then(() => realDelete(filter))) as never);
    try {
      expect((await cancel(inviteId, ownerId)).status).toBe(409);

      expect(racing).toHaveBeenCalled();
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
      expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).not.toBeNull();
      expect(await inviteNotifications()).toBe(1);
    } finally {
      racing.mockRestore();
    }
  });

  // regression: accept granted the role before it recorded `accepted`, so a cancel
  // landing mid-accept deleted the invite and told the owner "cancelled", and the
  // accept let the person in anyway (then failed to save the invite it no longer
  // had, and answered 500).
  it('regression: a cancel that lands during an accept wins, and nobody joins', async () => {
    const race = holdFirstCall(WishlistInvite, 'findById', () => cancel(inviteId, ownerId), {
      after: true,
    });
    try {
      const accepted = await respond(inviteId, 'accept', inviteeId);

      expect(race.outcome()?.status).toBe(200);
      expect(accepted.status).toBe(404);
      expect(await WishlistInvite.findById(inviteId)).toBeNull();
      expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).toBeNull();
    } finally {
      race.restore();
    }
  });

  it('a cancel that lands once an accept has claimed the invite gets a 409, and the accept completes', async () => {
    const race = holdFirstCall(WishlistInvite, 'updateOne', () => cancel(inviteId, ownerId), {
      after: true,
    });
    try {
      const accepted = await respond(inviteId, 'accept', inviteeId);

      expect(race.outcome()?.status).toBe(409);
      expect(accepted.status).toBe(200);
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
      expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).not.toBeNull();
    } finally {
      race.restore();
    }
  });

  // regression: a malformed id made the lookup throw a CastError, so the route
  // answered 500 "Failed to cancel invite" instead of 404.
  it.each(['not-an-id', '12345', 'z'.repeat(24)])(
    'regression: answers 404 for a malformed invite id (%s)',
    async (badId) => {
      const res = await cancel(badId, ownerId);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
      expect(await WishlistInvite.countDocuments()).toBe(2);
    }
  );

  it('answers 404 for an invite that no longer exists', async () => {
    await WishlistInvite.deleteOne({ _id: inviteId });

    const res = await cancel(inviteId, ownerId);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Invite not found');
  });

  // Until the `dedupe-pending-invites` migration has built the unique pending
  // index, a person can hold two pending invites to one list, and the
  // notification (which carries no invite id) could be the other one's.
  it('keeps the notification while another pending invite for them remains', async () => {
    await WishlistInvite.init();
    await WishlistInvite.collection.dropIndex('wishlist_1_invitedUser_1');
    try {
      await WishlistInvite.create({
        wishlist: wishlistId,
        invitedBy: ownerId,
        invitedUser: inviteeId,
        role: 'owner',
      });

      expect((await cancel(inviteId, ownerId)).status).toBe(200);

      expect(await WishlistInvite.findById(inviteId)).toBeNull();
      expect(await inviteNotifications()).toBe(1);
    } finally {
      await clearTestDB();
      await WishlistInvite.createIndexes();
    }
  });

  // A co-owner re-invites them between the pending check and the delete: the
  // re-invite's notification is newer than the cancel, so it must survive it.
  it('keeps the notification of a re-invite that lands mid-cancel', async () => {
    const realExists = WishlistInvite.exists.bind(WishlistInvite);
    let reinviteNotification = '';
    const racing = vi.spyOn(WishlistInvite, 'exists').mockImplementationOnce(((filter: object) =>
      realExists(filter).then(async (found) => {
        await WishlistInvite.create({
          wishlist: wishlistId,
          invitedBy: ownerId,
          invitedUser: inviteeId,
          role: 'member',
        });
        const n = await Notification.create({
          user: inviteeId,
          type: 'wishlist_invite',
          wishlist: wishlistId,
          wishlistName: 'List',
        });
        reinviteNotification = n._id.toString();
        return found;
      })) as never);
    try {
      expect((await cancel(inviteId, ownerId)).status).toBe(200);

      expect(racing).toHaveBeenCalled();
      const left = await Notification.find({
        user: inviteeId,
        wishlist: wishlistId,
        type: 'wishlist_invite',
      });
      expect(left.map((n) => n._id.toString())).toEqual([reinviteNotification]);
    } finally {
      racing.mockRestore();
    }
  });

  it('still cancels the invite and succeeds when the notification cleanup fails', async () => {
    const failing = vi
      .spyOn(Notification, 'deleteMany')
      .mockRejectedValueOnce(new Error('db hiccup'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await cancel(inviteId, ownerId);
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);

      expect(await WishlistInvite.findById(inviteId)).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining(inviteId), expect.any(Error));
    } finally {
      failing.mockRestore();
      log.mockRestore();
    }
  });

  it('refuses anyone but an owner, and leaves the invite and its notification', async () => {
    expect((await cancel(inviteId, inviteeId)).status).toBe(403);

    expect(await WishlistInvite.findById(inviteId)).not.toBeNull();
    expect(await inviteNotifications()).toBe(1);
  });

  it("won't cancel an invite through a different list's URL", async () => {
    expect((await cancel(inviteId, ownerId, otherListId)).status).toBe(404);

    expect(await WishlistInvite.findById(inviteId)).not.toBeNull();
    expect(await inviteNotifications()).toBe(1);
  });
});
