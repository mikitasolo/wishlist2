import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as listRequests, POST as ask } from '@/app/api/wishlists/[id]/requests/route';
import { GET as myRequest, DELETE as cancelMine } from '@/app/api/wishlists/[id]/requests/me/route';
import { PATCH as answer } from '@/app/api/wishlists/[id]/requests/[requestId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { DELETE as deleteWishlist } from '@/app/api/wishlists/[id]/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import Notification from '@/models/Notification';
import { ASK_AGAIN_AFTER_MS } from '@/lib/utils/joinRequests';

const session = vi.mocked(auth);

const denyAll: RateLimiter = {
  async limit() {
    return { success: false, reset: Date.now() + 60_000, limit: 10, remaining: 0 };
  },
};

let ownerId: string;
let coOwnerId: string;
let ivanId: string;
let memberId: string;
let listId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  // The unique partial index the "one pending request" rule rests on.
  await WishlistJoinRequest.createIndexes();
  session.mockReset();
  sendEmail.mockReset();
  ownerId = (await User.create({ email: 'anna@x.com', username: 'anna' }))._id.toString();
  coOwnerId = (await User.create({ email: 'chloe@x.com', username: 'chloe' }))._id.toString();
  ivanId = (
    await User.create({ email: 'ivan@secret.com', username: 'ivan_petrov', image: '/ivan.png' })
  )._id.toString();
  memberId = (await User.create({ email: 'mo@x.com', username: 'mo' }))._id.toString();
  const list = await Wishlist.create({
    name: 'Anna’s 30th',
    slug: 'anna-30',
    owners: [ownerId, coOwnerId],
    visibility: 'everyone',
  });
  listId = list._id.toString();
  await WishlistMember.create({ wishlist: listId, user: memberId });
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

const as = (userId: string | null, username?: string) =>
  session.mockResolvedValue((userId ? { user: { id: userId, username } } : null) as never);

const ctx = (id = listId) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });

function askAs(userId: string | null, username?: string, id = listId) {
  as(userId, username);
  return ask(req(`/api/wishlists/${id}/requests`, 'POST'), ctx(id));
}
function readMine(userId: string, id = listId) {
  as(userId);
  return myRequest(req(`/api/wishlists/${id}/requests/me`, 'GET'), ctx(id));
}
function cancelAs(userId: string, id = listId) {
  as(userId);
  return cancelMine(req(`/api/wishlists/${id}/requests/me`, 'DELETE'), ctx(id));
}
function listAs(userId: string | null, id = listId) {
  as(userId);
  return listRequests(req(`/api/wishlists/${id}/requests`, 'GET'), ctx(id));
}
function answerAs(userId: string, requestId: string, action: string, username = 'anna') {
  as(userId, username);
  return answer(req(`/api/wishlists/${listId}/requests/${requestId}`, 'PATCH', { action }), {
    params: Promise.resolve({ id: listId, requestId }),
  });
}
async function requestIdOf(userId = ivanId) {
  const row = await WishlistJoinRequest.findOne({
    wishlist: listId,
    user: userId,
    status: 'pending',
  });
  return row!._id.toString();
}
const ownerAlerts = () => Notification.find({ type: 'join_request', wishlist: listId }).lean();

describe('POST /api/wishlists/[id]/requests (Ask to join)', () => {
  it('records one pending request and notifies every owner by the requester’s handle', async () => {
    const res = await askAs(ivanId, 'ivan_petrov');
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ requested: true });

    expect(await WishlistJoinRequest.countDocuments({ wishlist: listId, user: ivanId })).toBe(1);
    const alerts = await ownerAlerts();
    expect(alerts.map((n) => n.user.toString()).sort()).toEqual([ownerId, coOwnerId].sort());
    for (const n of alerts) {
      expect(n.actorUsername).toBe('ivan_petrov');
      expect(n.actor?.toString()).toBe(ivanId);
      expect(n.wishlistSlug).toBe('anna-30');
      // Never the requester's email.
      expect(JSON.stringify(n)).not.toContain('secret.com');
    }
    // Nobody is invited, and nobody joins, by asking.
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistMember.exists({ wishlist: listId, user: ivanId })).toBeNull();
  });

  it('asks a signed-out caller to sign in, whether or not the list exists', async () => {
    expect((await askAs(null)).status).toBe(401);
    expect((await askAs(null, undefined, 'no-such-list')).status).toBe(401);
  });

  it('keeps one pending request per person per list, and notifies the owners once', async () => {
    const [a, b] = await Promise.all([askAs(ivanId, 'ivan_petrov'), askAs(ivanId, 'ivan_petrov')]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await WishlistJoinRequest.countDocuments({ wishlist: listId, user: ivanId })).toBe(1);
    expect(await ownerAlerts()).toHaveLength(2);
    // The index itself refuses a second pending row.
    await expect(
      WishlistJoinRequest.create({ wishlist: listId, user: ivanId, status: 'pending' })
    ).rejects.toThrow(/duplicate key/);
  });

  it('is rate-limited, and a refused ask records and notifies nothing', async () => {
    __setRateLimiters({ joinRequest: denyAll });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await askAs(ivanId, 'ivan_petrov')).status).toBe(429);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
  });

  it.each([
    { who: 'an owner', userId: () => ownerId },
    { who: 'a member', userId: () => memberId },
  ])('refuses $who: they’re already on the list', async ({ userId }) => {
    const res = await askAs(userId(), 'x');
    expect(res.status).toBe(409);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
  });

  it('refuses someone who already has an invite waiting', async () => {
    await WishlistInvite.create({
      wishlist: listId,
      invitedBy: ownerId,
      invitedUser: ivanId,
      role: 'member',
    });
    expect((await askAs(ivanId, 'ivan_petrov')).status).toBe(409);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
  });

  it('lets a friend of an owner ask on a friends-only list', async () => {
    await Wishlist.updateOne({ _id: listId }, { visibility: 'friends' });
    await Follow.create([
      { follower: ivanId, following: coOwnerId },
      { follower: coOwnerId, following: ivanId },
    ]);
    expect((await askAs(ivanId, 'ivan_petrov')).status).toBe(201);
  });

  // regression: an ask that lands after the list's delete has cleaned up its
  // requests must not leave a row (or notifications) behind for a deleted list.
  it('takes its own row back when the list is deleted under it', async () => {
    holdFirstCall(WishlistJoinRequest, 'create', async () => {
      as(ownerId);
      await deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), ctx());
    });
    const res = await askAs(ivanId, 'ivan_petrov');
    expect(res.status).toBe(404);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
  });
});

describe('a list the caller can’t open answers exactly like a missing one', () => {
  async function hide(kind: 'private' | 'friends' | 'archived') {
    if (kind === 'archived') await Wishlist.updateOne({ _id: listId }, { archived: true });
    else await Wishlist.updateOne({ _id: listId }, { visibility: kind });
  }
  const missingId = '0123456789abcdef01234567';

  it.each(['private', 'friends', 'archived'] as const)('%s', async (kind) => {
    // Asked first, while it was open, so cancel and read have a row to find.
    await askAs(ivanId, 'ivan_petrov');
    await hide(kind);

    for (const call of [
      () => askAs(ivanId, 'ivan_petrov'),
      () => readMine(ivanId),
      () => cancelAs(ivanId),
    ]) {
      const hidden = await call();
      const missing = await (async () => {
        const original = listId;
        listId = missingId;
        try {
          return await call();
        } finally {
          listId = original;
        }
      })();
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await hidden.json()).toEqual(await missing.json());
    }
    // regression: a list hidden after they asked still lets them take their
    // own request back (it would otherwise sit in front of the owners), though
    // the answer stays the missing list's.
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
  });

  it('archived: the owners’ list of requests is a missing list to anyone else', async () => {
    await hide('archived');
    const res = await listAs(ivanId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Wishlist not found' });
  });
});

describe('the requester’s own request', () => {
  it('reads as requested once asked, and cancelling ends it and the owners’ notifications', async () => {
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: false });
    await askAs(ivanId, 'ivan_petrov');
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: true });

    const res = await cancelAs(ivanId);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ requested: false });
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: false });
  });

  it('never reads as requested for an owner or a member', async () => {
    expect((await (await readMine(memberId)).json()).data).toEqual({ requested: false });
    expect((await (await readMine(ownerId)).json()).data).toEqual({ requested: false });
  });
});

describe('GET /api/wishlists/[id]/requests (owners)', () => {
  it('lists pending requests by public handle and photo, never an email', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const res = await listAs(coOwnerId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        _id: await requestIdOf(),
        user: { _id: ivanId, username: 'ivan_petrov', image: '/ivan.png' },
        createdAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('@secret.com');
  });

  it('refuses a member (403) and a visitor', async () => {
    await askAs(ivanId, 'ivan_petrov');
    expect((await listAs(memberId)).status).toBe(403);
    expect((await listAs(ivanId)).status).toBe(403);
  });

  it('leaves out a requester who is on the list by now', async () => {
    await askAs(ivanId, 'ivan_petrov');
    await WishlistMember.create({ wishlist: listId, user: ivanId });
    expect((await (await listAs(ownerId)).json()).data).toEqual([]);
  });
});

describe('PATCH /api/wishlists/[id]/requests/[requestId] (Invite / Decline)', () => {
  it('Invite issues a normal member invite, and the requester joins only by accepting it', async () => {
    // Their `whoCanInvite` doesn't apply: they asked.
    await User.updateOne({ _id: ivanId }, { 'privacy.whoCanInvite': 'nobody' });
    await askAs(ivanId, 'ivan_petrov');
    const res = await answerAs(coOwnerId, await requestIdOf(), 'invite', 'chloe');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'invited' });

    const invite = await WishlistInvite.findOne({ wishlist: listId, invitedUser: ivanId });
    expect(invite).toMatchObject({ role: 'member', status: 'pending' });
    expect(invite!.invitedBy.toString()).toBe(coOwnerId);
    expect(invite!.promotion).toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // The request is over, and so are the owners' notifications about it.
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
    // Not a member until they accept.
    expect(await WishlistMember.exists({ wishlist: listId, user: ivanId })).toBeNull();

    as(ivanId, 'ivan_petrov');
    const accepted = await respondInvite(
      req(`/api/invites/${invite!._id}`, 'PATCH', { action: 'accept' }),
      { params: Promise.resolve({ inviteId: invite!._id.toString() }) }
    );
    expect(accepted.status).toBe(200);
    expect(await WishlistMember.exists({ wishlist: listId, user: ivanId })).not.toBeNull();
    expect(await isOwner(ivanId)).toBe(false);
  });

  it('Decline ends it silently: no notification, and the requester still reads Requested', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const res = await answerAs(ownerId, await requestIdOf(), 'decline');
    expect(res.status).toBe(200);
    expect(await ownerAlerts()).toHaveLength(0);
    expect(await Notification.countDocuments({ user: ivanId })).toBe(0);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: true });
    // Gone from the owners' Requests.
    expect((await (await listAs(ownerId)).json()).data).toEqual([]);
  });

  it('after a decline, asking again within 30 days tells nobody; after 30 days it’s a new request', async () => {
    await askAs(ivanId, 'ivan_petrov');
    await answerAs(ownerId, await requestIdOf(), 'decline');

    // Cancelled (unknowingly, a declined one) and asked again: silent.
    expect((await (await cancelAs(ivanId)).json()).data).toEqual({ requested: false });
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: false });
    const again = await askAs(ivanId, 'ivan_petrov');
    expect(again.status).toBe(201);
    expect((await again.json()).data).toEqual({ requested: true });
    expect(await ownerAlerts()).toHaveLength(0);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(0);

    // 30 days on, they may ask again for real.
    await WishlistJoinRequest.updateMany(
      { status: 'declined' },
      { declinedAt: new Date(Date.now() - ASK_AGAIN_AFTER_MS - 1000) }
    );
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: false });
    expect((await askAs(ivanId, 'ivan_petrov')).status).toBe(201);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(1);
    expect(await ownerAlerts()).toHaveLength(2);
  });

  // regression: Decline re-reads the caller's ownership right before its write,
  // so an owner removed while it was on its way can't hold anyone off.
  it('a Decline from an owner removed mid-request changes nothing', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const id = await requestIdOf();
    as(coOwnerId, 'chloe');
    const declineReq = req(`/api/wishlists/${listId}/requests/${id}`, 'PATCH', {
      action: 'decline',
    });
    // A co-owner removes them while the body is being read, after the first owner check.
    vi.spyOn(declineReq, 'json').mockImplementation(async () => {
      await Wishlist.updateOne({ _id: listId }, { $pull: { owners: coOwnerId } });
      return { action: 'decline' };
    });
    const res = await answer(declineReq, {
      params: Promise.resolve({ id: listId, requestId: id }),
    });
    expect(res.status).toBe(403);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('refuses a member (403), and a malformed or unknown request is not found', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const id = await requestIdOf();
    expect((await answerAs(memberId, id, 'invite')).status).toBe(403);
    expect((await answerAs(ivanId, id, 'decline')).status).toBe(403);
    expect((await answerAs(ownerId, 'nope', 'invite')).status).toBe(404);
    expect((await answerAs(ownerId, '0123456789abcdef01234567', 'decline')).status).toBe(404);
    expect((await answerAs(ownerId, id, 'approve')).status).toBe(400);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('Invite on an archived list is refused, as any member invite is there', async () => {
    await askAs(ivanId, 'ivan_petrov');
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    const res = await answerAs(ownerId, await requestIdOf(), 'invite');
    expect(res.status).toBe(409);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('Invite spends the inviter’s invite budget', async () => {
    await askAs(ivanId, 'ivan_petrov');
    __setRateLimiters({ invite: denyAll });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await answerAs(ownerId, await requestIdOf(), 'invite')).status).toBe(429);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
  });

  // regression: of an owner's Invite and the requester's cancel, exactly one
  // lands. A cancel just before the claim leaves nothing to invite.
  it('an Invite that loses to the requester’s cancel issues nothing', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const id = await requestIdOf();
    holdFirstCall(WishlistJoinRequest, 'findOneAndDelete', () => cancelAs(ivanId));
    const res = await answerAs(ownerId, id, 'invite');
    expect(res.status).toBe(404);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
  });

  it('an Invite that loses to a co-owner’s Decline issues nothing', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const id = await requestIdOf();
    holdFirstCall(WishlistJoinRequest, 'findOneAndDelete', () =>
      answerAs(coOwnerId, id, 'decline', 'chloe')
    );
    expect((await answerAs(ownerId, id, 'invite')).status).toBe(404);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistJoinRequest.countDocuments({ status: 'declined' })).toBe(1);
  });

  // regression: an owner removed after the request's owner re-check doesn't
  // leave an invite behind, and the request is put back for the other owners.
  it('an inviter removed mid-request has the invite taken back, and the request stays', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const id = await requestIdOf();
    holdFirstCall(
      WishlistInvite,
      'create',
      async () => {
        await Wishlist.updateOne({ _id: listId }, { $pull: { owners: coOwnerId } });
      },
      { after: true }
    );
    const res = await answerAs(coOwnerId, id, 'invite', 'chloe');
    expect(res.status).toBe(403);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('a requester who joined meanwhile isn’t invited, and the request ends', async () => {
    await askAs(ivanId, 'ivan_petrov');
    await WishlistMember.create({ wishlist: listId, user: ivanId });
    const res = await answerAs(ownerId, await requestIdOf(), 'invite');
    expect(res.status).toBe(409);
    expect(await WishlistInvite.countDocuments({})).toBe(0);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
  });
});

async function isOwner(userId: string) {
  const list = await Wishlist.findById(listId).lean();
  return list!.owners.some((o) => o.toString() === userId);
}

describe('no request outlives the list or a membership', () => {
  it('deleting the list deletes its requests and their notifications', async () => {
    await askAs(ivanId, 'ivan_petrov');
    as(ownerId);
    expect((await deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), ctx())).status).toBe(
      200
    );
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({ type: 'join_request' })).toBe(0);
  });

  it('joining through any invite ends a pending request', async () => {
    await askAs(ivanId, 'ivan_petrov');
    const invite = await WishlistInvite.create({
      wishlist: listId,
      invitedBy: ownerId,
      invitedUser: ivanId,
      role: 'member',
    });
    as(ivanId, 'ivan_petrov');
    await respondInvite(req(`/api/invites/${invite._id}`, 'PATCH', { action: 'accept' }), {
      params: Promise.resolve({ inviteId: invite._id.toString() }),
    });
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect(await ownerAlerts()).toHaveLength(0);
  });

  // regression: a request that slipped past its cleanup (the ask raced the
  // join) mustn't come back to the owners' Requests once they're removed.
  it('kicking a member ends a request they still had', async () => {
    await WishlistJoinRequest.create({ wishlist: listId, user: memberId });
    const membership = await WishlistMember.findOne({ wishlist: listId, user: memberId });
    as(ownerId);
    const res = await kick(req(`/api/wishlists/${listId}/members/${membership!._id}`, 'DELETE'), {
      params: Promise.resolve({ id: listId, memberId: membership!._id.toString() }),
    });
    expect(res.status).toBe(200);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    expect((await (await listAs(ownerId)).json()).data).toEqual([]);
  });

  // regression: a declined request mustn't read as Requested again once they've
  // been on the list and left it.
  it('joining answers a declined request too: off the list again, it isn’t Requested', async () => {
    await askAs(ivanId, 'ivan_petrov');
    await answerAs(ownerId, await requestIdOf(), 'decline');
    const invite = await WishlistInvite.create({
      wishlist: listId,
      invitedBy: coOwnerId,
      invitedUser: ivanId,
      role: 'member',
    });
    as(ivanId, 'ivan_petrov');
    await respondInvite(req(`/api/invites/${invite._id}`, 'PATCH', { action: 'accept' }), {
      params: Promise.resolve({ inviteId: invite._id.toString() }),
    });
    as(ivanId);
    expect((await leave(req(`/api/wishlists/${listId}/members/me`, 'DELETE'), ctx())).status).toBe(
      200
    );
    expect((await (await readMine(ivanId)).json()).data).toEqual({ requested: false });
  });

  it('leaving ends a request they still had', async () => {
    await WishlistJoinRequest.create({ wishlist: listId, user: memberId });
    as(memberId);
    const res = await leave(req(`/api/wishlists/${listId}/members/me`, 'DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
  });
});
