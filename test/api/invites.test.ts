import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

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
