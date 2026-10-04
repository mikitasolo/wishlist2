import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/invites/[inviteId]/route';
import { DELETE as cancelInvite } from '@/app/api/wishlists/[id]/invites/[inviteId]/route';
import { DELETE as deleteWishlist } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

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
  // a different user cannot act on someone else's invite. Answered as a missing
  // invite (WIS-100), so it doesn't even confirm the invite exists.
  it('regression: a different user cannot accept the invite', async () => {
    const other = await User.create({ email: 'other@x.com', username: 'other' });
    const res = await respond(inviteId, 'accept', other._id.toString());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
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

  // regression: a malformed id made `findById` throw a CastError, so the route
  // answered 500 "Failed to update invite" instead of 404.
  it.each(['not-an-id', '12345', 'z'.repeat(24)])(
    'regression: answers 404 for a malformed invite id (%s)',
    async (badId) => {
      for (const action of ['accept', 'decline']) {
        const res = await respond(badId, action, inviteeId);

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
      }
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
    }
  );
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
  it('regression: of two accepts at once, one lets them in and the other is told it already did', async () => {
    const race = holdFirstCall(
      WishlistInvite,
      'findById',
      () => respond(inviteId, 'accept', inviteeId),
      { after: true }
    );

    const first = await respond(inviteId, 'accept', inviteeId);

    expect(race.outcome()?.status).toBe(200);
    expect(first.status).toBe(409);
    const { data } = await first.json();
    expect(data).toEqual({
      status: 'accepted',
      wishlistSlug: (await Wishlist.findById(wishlistId))!.slug ?? null,
      wishlistId,
    });
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
    expect(accepted.status).toBe(409);
    expect((await accepted.json()).data).toEqual({ status: 'declined' });
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await member()).toBeNull();
    expect(await acceptedNotifications()).toBe(0);
  });

  it('an accept that lands during a decline wins, and the decline is told it joined', async () => {
    const race = holdFirstCall(
      WishlistInvite,
      'findById',
      () => respond(inviteId, 'accept', inviteeId),
      { after: true }
    );

    const declined = await respond(inviteId, 'decline', inviteeId);

    expect(race.outcome()?.status).toBe(200);
    expect(declined.status).toBe(409);
    expect((await declined.json()).data.status).toBe('accepted');
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

// An owner deletes the list while the invitee accepts. The delete removes the list
// first and only then its memberships, invites and notifications, so an accept that
// read the list before it must not grant anything on it afterwards.
describe('PATCH /api/invites/[inviteId] racing a list delete', () => {
  beforeEach(async () => {
    // What issuing the invite left behind.
    await Notification.create({
      user: inviteeId,
      type: 'wishlist_invite',
      wishlist: wishlistId,
      wishlistName: 'List',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function deleteList() {
    session.mockResolvedValueOnce({ user: { id: ownerId } } as never);
    const req = new NextRequest(`http://localhost/api/wishlists/${wishlistId}`, {
      method: 'DELETE',
    });
    return deleteWishlist(req, { params: Promise.resolve({ id: wishlistId }) });
  }

  /**
   * A reservation the invitee holds on the list (a member's booking, or one they
   * kept when they left). Deleting the list keeps it, so they can still log the gift.
   */
  async function inviteeReservation() {
    const item = await Item.create({ wishlist: wishlistId, name: 'Gift', status: 'available' });
    const reservation = await Reservation.create({
      gifter: inviteeId,
      wishlist: wishlistId,
      item: item._id,
      owner: ownerId,
      itemName: 'Gift',
      wishlistName: 'List',
    });
    return reservation._id;
  }

  /** The delete won: the accept got the gone-list 404 and left nothing on the list. */
  async function expectDeleteWon(
    accepted: Response,
    race: { held: () => boolean; outcome: () => Response | undefined }
  ) {
    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(await Wishlist.exists({ _id: wishlistId })).toBeNull();
    expect(await WishlistMember.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await WishlistInvite.countDocuments({ wishlist: wishlistId })).toBe(0);
    // No `invite_accepted` for the inviter, and nothing else pointing at the list.
    expect(await Notification.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(accepted.status).toBe(404);
    expect(await accepted.json()).toEqual({
      success: false,
      error: 'This wishlist no longer exists',
    });
  }

  // regression: joining was an upsert on the membership, against a list read before
  // the delete landed. The delete's membership cleanup had already run, so the upsert
  // left a membership for a list that no longer existed, and the invitee was told
  // "Joined" and sent to a list that 404'd.
  it('regression: a delete that lands just before a member joins leaves no membership, and the accept gets a 404', async () => {
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    await expectDeleteWon(accepted, race);
  });

  it('a delete that lands just after a member joins answers the accept with the same 404', async () => {
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', deleteList, { after: true });

    const accepted = await respond(inviteId, 'accept', inviteeId);

    await expectDeleteWon(accepted, race);
  });

  // The other half of what joining relies on: a delete removes the list before its
  // memberships. So an accept that finds the list still there once it has joined is
  // followed by the delete's membership cleanup, which takes the row.
  it('an accept that completes while the delete is about to remove the list leaves no membership either', async () => {
    const race = holdFirstCall(Wishlist, 'findOneAndDelete', () =>
      respond(inviteId, 'accept', inviteeId)
    );

    const deleted = await deleteList();

    expect(race.held()).toBe(true);
    // The accept landed first, so it got in, and then the list went with everything on it.
    expect(race.outcome()?.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(await WishlistMember.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await WishlistInvite.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await Notification.countDocuments({ wishlist: wishlistId })).toBe(0);
  });

  // regression: the accept was granted while the list still existed, and the delete
  // then ran to completion, notification cleanup included, before the accept wrote
  // the inviter's `invite_accepted`. Nothing took that one, so it outlived the list
  // as a link to a 404 in the inviter's notifications.
  it('regression: a delete that lands just before the inviter is told leaves no notification for the list', async () => {
    const race = holdFirstCall(Notification, 'create', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    expect(race.held()).toBe(true);
    // The accept had already won (the grant landed first), so it still answers 200.
    expect(accepted.status).toBe(200);
    expect(race.outcome()?.status).toBe(200);
    expect(await Wishlist.exists({ _id: wishlistId })).toBeNull();
    expect(await WishlistMember.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await Notification.countDocuments({ wishlist: wishlistId })).toBe(0);
    expect(await Notification.countDocuments({ user: ownerId })).toBe(0);
  });

  // The claimed invite goes with the list, as the delete's own invite cleanup would
  // have taken it (and the invite's notification with it), even when that cleanup
  // failed. It isn't reopened: accepting again could never succeed.
  it("withdraws the claimed invite even when the delete's own invite cleanup fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(WishlistInvite, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup'));
    vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup'));
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    await expectDeleteWon(accepted, race);
  });

  // regression: the ownership write matched no list, and becoming an owner went on to
  // release the invitee's bookings there anyway. That deleted the reservation they
  // kept when they left the list earlier, which the list delete keeps on purpose so
  // they can still log the gift, and the invitee was told they'd joined.
  it('regression: a delete that lands just before an owner invite is granted releases nothing, and the accept gets a 404', async () => {
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    const reservationId = await inviteeReservation();
    const race = holdFirstCall(Wishlist, 'updateOne', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    // The delete keeps a list's reservations for their gifters.
    expect(await Reservation.exists({ _id: reservationId })).not.toBeNull();
    await expectDeleteWon(accepted, race);
  });

  // regression: as above, for a promotion. Its membership row was already taken, so
  // there's no membership to orphan, but the release still ran.
  it('regression: a delete that lands mid-promotion releases nothing, and the accept gets a 404', async () => {
    await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner', promotion: true } });
    const reservationId = await inviteeReservation();
    // After the membership row is taken, before ownership is granted.
    const race = holdFirstCall(Wishlist, 'updateOne', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    // The delete keeps a list's reservations for their gifters.
    expect(await Reservation.exists({ _id: reservationId })).not.toBeNull();
    await expectDeleteWon(accepted, race);
  });

  // The delete took the membership row before the promotion could, which looks like
  // a kick to the promotion. The answer says what really happened.
  it('a delete that lands before a promotion takes the membership answers with the gone-list 404', async () => {
    await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner', promotion: true } });
    const race = holdFirstCall(WishlistMember, 'findOneAndDelete', deleteList);

    const accepted = await respond(inviteId, 'accept', inviteeId);

    await expectDeleteWon(accepted, race);
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
    const otherList = await Wishlist.create({
      name: 'Other',
      owners: [ownerId],
      visibility: 'everyone',
    });
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

  // Without the unique pending index (dropped here to set this up), a person can
  // hold two pending invites to one list, and the notification (which carries
  // no invite id) could be the other one's.
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
      expect(log).toHaveBeenCalledWith(expect.stringContaining(inviteId), {
        name: 'Error',
        code: undefined,
      });
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

// WIS-100: an invite the invitee has already answered (another tab, another
// device) is told apart from one that's gone, but only to its invitee, and the
// list's link only while they can still open it.
describe('PATCH /api/invites/[inviteId] on an invite already answered', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const answered = async (status: 'accepted' | 'declined') => {
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { status } });
  };

  // regression: an invite accepted in another tab answered the same 404 as a
  // cancelled one, so the invitee was told it was no longer available.
  it.each(['accept', 'decline'])(
    'answers 409 with the list link to %s an invite they already accepted',
    async (action) => {
      expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);
      await Wishlist.updateOne({ _id: wishlistId }, { $set: { slug: 'the-list' } });

      const res = await respond(inviteId, action, inviteeId);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false,
        error: 'This invitation has already been answered.',
        data: { status: 'accepted', wishlistSlug: 'the-list', wishlistId },
      });
      // Nothing changed: still accepted, still one membership, one notification.
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
      expect(await WishlistMember.countDocuments({ wishlist: wishlistId })).toBe(1);
      expect(await Notification.countDocuments({ user: ownerId, type: 'invite_accepted' })).toBe(1);
    }
  );

  it('answers 409 declined, with nothing about the list, to an invite they declined', async () => {
    await answered('declined');

    const res = await respond(inviteId, 'accept', inviteeId);

    expect(res.status).toBe(409);
    expect((await res.json()).data).toEqual({ status: 'declined' });
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).toBeNull();
  });

  // An accepted invite outlives a leave or a kick (only pending ones are
  // cancelled), so "already joined" would be wrong once they're off the list,
  // even one anyone can open.
  it.each(['friends', 'everyone'] as const)(
    'answers 404 once they have left the (%s) list they accepted',
    async (visibility) => {
      expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);
      await Wishlist.updateOne({ _id: wishlistId }, { $set: { visibility } });
      await WishlistMember.deleteOne({ wishlist: wishlistId, user: inviteeId });

      const res = await respond(inviteId, 'accept', inviteeId);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
    }
  );

  // An invite only claimed by an accept still granting the role may yet be
  // reopened or withdrawn, so it isn't "already joined" until the role is there.
  it('answers 404 while the accept that claimed it has not granted the role yet', async () => {
    await answered('accepted');

    const res = await respond(inviteId, 'decline', inviteeId);

    expect(res.status).toBe(404);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
  });

  it('answers 404 to an accepted owner invite while they are still only a member', async () => {
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    await answered('accepted');
    await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });

    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(404);
  });

  it('gives an accepted owner invite the link once they are an owner', async () => {
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { role: 'owner' } });
    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(200);

    const res = await respond(inviteId, 'accept', inviteeId);

    expect(res.status).toBe(409);
    expect((await res.json()).data).toEqual({
      status: 'accepted',
      wishlistSlug: (await Wishlist.findById(wishlistId))!.slug ?? null,
      wishlistId,
    });
  });

  it('gives the link to an invitee who has since become an owner', async () => {
    await answered('accepted');
    await Wishlist.updateOne({ _id: wishlistId }, { $push: { owners: inviteeId } });

    expect((await (await respond(inviteId, 'accept', inviteeId)).json()).data).toMatchObject({
      status: 'accepted',
      wishlistId,
    });
  });

  // An archived list stays indistinguishable from a missing one to a non-owner.
  it.each(['accepted', 'declined'] as const)(
    'answers an invite %s on a list archived since as a missing one',
    async (status) => {
      await answered(status);
      await WishlistMember.create({ wishlist: wishlistId, user: inviteeId });
      await Wishlist.updateOne({ _id: wishlistId }, { $set: { archived: true } });

      const res = await respond(inviteId, 'accept', inviteeId);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
    }
  );

  it("answers someone else's answered invite as a missing one", async () => {
    await answered('accepted');
    const other = await User.create({ email: 'other@x.com', username: 'other' });

    const res = await respond(inviteId, 'accept', other._id.toString());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
  });

  // An accept that found the list deleted declines the invite on its way out:
  // that isn't the invitee's answer, so a retry isn't told they declined it.
  it('answers an answered invite whose list is gone as a deleted list', async () => {
    await Wishlist.deleteOne({ _id: wishlistId });
    expect((await respond(inviteId, 'accept', inviteeId)).status).toBe(404);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');

    const res = await respond(inviteId, 'accept', inviteeId);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no longer exists/i);
  });

  // The claim matching nothing is re-read: an owner's cancel deleted the row,
  // so it's still the 404 of an invite that's gone.
  it.each(['accept', 'decline'])(
    'still answers 404 when an owner cancels the invite during a %s',
    async (action) => {
      const race = holdFirstCall(
        WishlistInvite,
        'findById',
        () => WishlistInvite.deleteOne({ _id: inviteId }),
        { after: true }
      );

      const res = await respond(inviteId, action, inviteeId);

      expect(race.held()).toBe(true);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
      expect(await WishlistMember.exists({ wishlist: wishlistId, user: inviteeId })).toBeNull();
    }
  );

  // A paused invite is still pending, so it keeps the 404 it always had.
  it('still answers 404 for a paused invite', async () => {
    await Wishlist.updateOne({ _id: wishlistId }, { $set: { archived: true } });

    for (const action of ['accept', 'decline']) {
      const res = await respond(inviteId, action, inviteeId);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Invite not found' });
    }
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
  });
});
