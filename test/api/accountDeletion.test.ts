import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-276: deleting an account erases everything in it at once, through the
// same helpers every other change of the kind goes through, and never leaves a
// list without an owner or a booking nobody can release.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));
const purge = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: (...a: unknown[]) => purge(...a) }));
// A store that records deletions instead of performing them.
const del = vi.fn().mockResolvedValue(undefined);
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: (...a: unknown[]) => del(...a),
  list: (...a: unknown[]) => list(...a),
  put: vi.fn(),
  head: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { DELETE as DELETE_ME } from '@/app/api/users/me/route';
import { GET as PREVIEW } from '@/app/api/users/me/deletion/route';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import Follow from '@/models/Follow';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const upload = (userId: string, name: string) => `${HOST}/uploads/${userId}/${name}`;
const snapshot = (name: string) => `${HOST}/snapshots/${name}`;

let ann: string; // the account being deleted
let bob: string; // owns lists ann is on, co-owns one with her
let cat: string; // a gifter on ann's lists
let annOid: mongoose.Types.ObjectId;

const db = () => mongoose.connection;

function deleteRequest(confirm: unknown, lists: string[] = []) {
  return new NextRequest('http://localhost/api/users/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm, lists }),
  });
}

/** Delete ann's account, agreeing to delete every list she owns as it stands now. */
async function eraseAnn(agreed?: string[]) {
  const owned = await Wishlist.find({ owners: ann }).select('_id').lean();
  return deleteAccount(ann, { agreedListIds: agreed ?? owned.map((l) => l._id.toString()) });
}

function signIn(id: string) {
  session.mockResolvedValue({ user: { id }, expires: '' } as never);
}

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  await Promise.all(
    ['sessions', 'accounts', 'verification_tokens'].map((c) => db().collection(c).deleteMany({}))
  );
  session.mockReset();
  del.mockClear();
  purge.mockClear();
  list.mockReset();
  list.mockResolvedValue({ blobs: [], cursor: undefined });
  __setRateLimiters(null);
  const make = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  ann = await make('ann');
  bob = await make('bob');
  cat = await make('cat');
  annOid = new mongoose.Types.ObjectId(ann);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setRateLimiters(null);
});

const reservationOf = (gifter: string, wishlist: string, item: string, owner: string) => ({
  gifter,
  wishlist,
  item,
  owner,
  itemName: 'Thing',
  wishlistName: 'List',
});

describe('DELETE /api/users/me: the request', () => {
  it('refuses a signed-out caller', async () => {
    session.mockResolvedValue(null as never);
    const res = await DELETE_ME(deleteRequest('ann'));
    expect(res.status).toBe(401);
  });

  it('refuses a confirmation that is not the username, and changes nothing', async () => {
    signIn(ann);
    const res = await DELETE_ME(deleteRequest('bob'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Type your username to confirm');
    expect(await User.exists({ _id: ann })).toBeTruthy();
  });

  it('takes the username in any case, with or without an @', async () => {
    signIn(ann);
    const res = await DELETE_ME(deleteRequest('  @ANN '));
    expect(res.status).toBe(200);
    expect(await User.exists({ _id: ann })).toBeNull();
  });

  it('asks for the email from an account with no username', async () => {
    await User.updateOne({ _id: ann }, { $unset: { username: 1 } });
    signIn(ann);
    const wrong = await DELETE_ME(deleteRequest('ann'));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe('Type your email to confirm');
    const right = await DELETE_ME(deleteRequest('Ann@x.com'));
    expect(right.status).toBe(200);
    expect(await User.exists({ _id: ann })).toBeNull();
  });

  it('is rate-limited before anything is read or erased', async () => {
    const limit = vi.fn<RateLimiter['limit']>().mockResolvedValue({
      success: false,
      reset: Date.now() + 60_000,
      limit: 5,
      remaining: 0,
    });
    __setRateLimiters({ accountDelete: { limit } });
    signIn(ann);
    const res = await DELETE_ME(deleteRequest('ann'));
    expect(res.status).toBe(429);
    expect(await User.exists({ _id: ann })).toBeTruthy();
  });

  it('deletes the lists the confirmation named', async () => {
    const mine = await Wishlist.create({ name: 'Mine', owners: [ann] });
    signIn(ann);
    const res = await DELETE_ME(deleteRequest('ann', [mine._id.toString()]));
    expect(res.status).toBe(200);
    expect(await Wishlist.exists({ _id: mine._id })).toBeNull();
    expect(await User.exists({ _id: ann })).toBeNull();
  });

  it('regression: refuses, changing nothing, when a list became its alone after the confirmation', async () => {
    // The dialog named no list; since then a co-owner left `later`, so deleting
    // the account would now delete it too, unasked.
    const later = await Wishlist.create({ name: 'Later', owners: [ann] });
    await db().collection('sessions').insertOne({ sessionToken: 't', userId: annOid });
    signIn(ann);
    const res = await DELETE_ME(deleteRequest('ann', []));
    expect(res.status).toBe(409);
    expect(await Wishlist.exists({ _id: later._id })).toBeTruthy();
    expect(await User.exists({ _id: ann })).toBeTruthy();
    expect(await db().collection('sessions').countDocuments({ userId: annOid })).toBe(1);
  });

  it('logs no personal data when the cascade fails', async () => {
    signIn(ann);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Follow, 'deleteMany').mockRejectedValueOnce(
      Object.assign(new Error('E11000 dup key: { email: "ann@x.com" }'), { code: 11000 })
    );
    const res = await DELETE_ME(deleteRequest('ann'));
    expect(res.status).toBe(500);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('ann@x.com');
    expect(logged).not.toContain(ann);
    // The account is still there to finish deleting.
    expect(await User.exists({ _id: ann })).toBeTruthy();
  });
});

describe('GET /api/users/me/deletion', () => {
  it('names only the lists the caller owns alone, archived ones included', async () => {
    await Wishlist.create({ name: 'Mine', owners: [ann] });
    await Wishlist.create({ name: 'Old', owners: [ann], archived: true });
    await Wishlist.create({ name: 'Shared', owners: [ann, bob] });
    await Wishlist.create({ name: 'Bobs', owners: [bob] });
    signIn(ann);
    const res = await PREVIEW();
    const names = (await res.json()).data.soleOwnedLists.map((l: { name: string }) => l.name);
    expect(names.sort()).toEqual(['Mine', 'Old']);
  });
});

describe('deleteAccount: the cascade', () => {
  it('deletes a list owned alone through the list delete, and keeps other gifters’ records', async () => {
    const list = await Wishlist.create({
      name: 'Mine',
      owners: [ann],
      bannerUrl: upload(ann, 'banner.jpg'),
    });
    const item = await Item.create({
      wishlist: list._id,
      name: 'Lamp',
      status: 'booked',
      bookedBy: cat,
    });
    await WishlistMember.create({ wishlist: list._id, user: cat });
    await Notification.create({ user: bob, type: 'removed_from_wishlist', wishlist: list._id });
    const catsBooking = await Reservation.create(
      reservationOf(cat, list._id.toString(), item._id.toString(), ann)
    );
    const catsGift = await GiftLog.create({ gifter: cat, giftedAt: new Date(), itemName: 'Old' });

    await eraseAnn();

    expect(await Wishlist.exists({ _id: list._id })).toBeNull();
    expect(await Item.exists({ wishlist: list._id })).toBeNull();
    expect(await WishlistMember.exists({ wishlist: list._id })).toBeNull();
    expect(await Notification.exists({ wishlist: list._id })).toBeNull();
    expect(purge).toHaveBeenCalledWith({ wishlistIds: [list._id.toString()] });
    expect(del).toHaveBeenCalledWith(upload(ann, 'banner.jpg'));
    // The gifter's own records stay, as with any list delete.
    expect(await Reservation.exists({ _id: catsBooking._id })).toBeTruthy();
    expect(await GiftLog.exists({ _id: catsGift._id })).toBeTruthy();
  });

  it('only takes the account off a co-owned list, which keeps working for the other owner', async () => {
    const list = await Wishlist.create({ name: 'Ours', owners: [bob, ann], featuredBy: [ann] });
    await Item.create({ wishlist: list._id, name: 'Lamp' });
    // An invite ann sent for it, and one she was sent elsewhere.
    await WishlistInvite.create({ wishlist: list._id, invitedBy: ann, invitedUser: cat });

    await eraseAnn();

    const after = await Wishlist.findById(list._id).lean();
    expect(after?.owners.map(String)).toEqual([bob]);
    expect(after?.featuredBy?.map(String)).toEqual([]);
    expect(await Item.countDocuments({ wishlist: list._id })).toBe(1);
    expect(await WishlistInvite.exists({ invitedBy: ann })).toBeNull();
  });

  it('frees the items it booked as a member and leaves the list, as a member leaving does', async () => {
    const list = await Wishlist.create({ name: 'Bobs', owners: [bob] });
    await WishlistMember.create({ wishlist: list._id, user: ann });
    const item = await Item.create({
      wishlist: list._id,
      name: 'Lamp',
      status: 'booked',
      bookedBy: ann,
    });
    // A booking on a list she's no longer on is freed too.
    const elsewhere = await Wishlist.create({ name: 'Other', owners: [bob] });
    const stray = await Item.create({
      wishlist: elsewhere._id,
      name: 'Kettle',
      status: 'booked',
      bookedBy: ann,
    });
    await WishlistInvite.create({ wishlist: elsewhere._id, invitedBy: bob, invitedUser: ann });

    await eraseAnn();

    expect((await Item.findById(item._id).lean())?.status).toBe('available');
    expect((await Item.findById(item._id).lean())?.bookedBy).toBeNull();
    expect((await Item.findById(stray._id).lean())?.status).toBe('available');
    expect(await WishlistMember.exists({ user: ann })).toBeNull();
    expect(await WishlistInvite.exists({ invitedUser: ann })).toBeNull();
    expect(await Wishlist.exists({ _id: list._id })).toBeTruthy();
  });

  it('erases its reservations and gift history, freeing their snapshots, and nobody else’s', async () => {
    const list = await Wishlist.create({ name: 'Bobs', owners: [bob] });
    const item = await Item.create({ wishlist: list._id, name: 'Lamp' });
    await Reservation.create({
      ...reservationOf(ann, list._id.toString(), item._id.toString(), bob),
      itemImage: snapshot('res.jpg'),
    });
    await GiftLog.create({
      gifter: ann,
      giftedAt: new Date(),
      itemName: 'Book',
      itemImage: snapshot('gift.jpg'),
    });
    const catsGift = await GiftLog.create({
      gifter: cat,
      giftedAt: new Date(),
      itemName: 'Mug',
      recipient: ann,
      itemImage: snapshot('cats.jpg'),
    });

    await eraseAnn();

    expect(await Reservation.exists({ gifter: ann })).toBeNull();
    expect(await GiftLog.exists({ gifter: ann })).toBeNull();
    expect(del).toHaveBeenCalledWith(snapshot('res.jpg'));
    expect(del).toHaveBeenCalledWith(snapshot('gift.jpg'));
    expect(del).not.toHaveBeenCalledWith(snapshot('cats.jpg'));
    expect(await GiftLog.exists({ _id: catsGift._id })).toBeTruthy();
  });

  it('frees its uploads after taking them off records that are someone else’s now', async () => {
    const shared = await Wishlist.create({
      name: 'Ours',
      owners: [bob, ann],
      bannerUrl: upload(ann, 'banner.jpg'),
    });
    const item = await Item.create({
      wishlist: shared._id,
      name: 'Lamp',
      imageUrl: upload(ann, 'lamp.jpg'),
    });
    const bobsItem = await Item.create({
      wishlist: shared._id,
      name: 'Kettle',
      imageUrl: upload(bob, 'kettle.jpg'),
    });
    await User.updateOne({ _id: ann }, { image: upload(ann, 'me.jpg') });
    list.mockResolvedValue({
      blobs: ['banner.jpg', 'lamp.jpg', 'me.jpg'].map((n) => ({ url: upload(ann, n) })),
      cursor: undefined,
    });

    await eraseAnn();

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: `uploads/${ann}/` }));
    // Read again in the second pass, for an upload already in flight.
    expect(list).toHaveBeenCalledTimes(2);
    expect((await Item.findById(item._id).lean())?.imageUrl).toBeUndefined();
    expect((await Item.findById(bobsItem._id).lean())?.imageUrl).toBe(upload(bob, 'kettle.jpg'));
    expect((await Wishlist.findById(shared._id).lean())?.bannerUrl).toBeNull();
    for (const n of ['banner.jpg', 'lamp.jpg', 'me.jpg']) {
      expect(del).toHaveBeenCalledWith(upload(ann, n));
    }
    expect(del).not.toHaveBeenCalledWith(upload(bob, 'kettle.jpg'));
  });

  it('erases follows, notifications, proposals’ link to it, sign-in records and the row', async () => {
    await Follow.create({ follower: ann, following: bob });
    await Follow.create({ follower: cat, following: ann });
    const bobFollowsCat = await Follow.create({ follower: bob, following: cat });
    await Notification.create({ user: ann, type: 'follow' });
    await Notification.create({ user: bob, type: 'follow', actor: ann, actorUsername: 'ann' });
    const bobsOther = await Notification.create({ user: bob, type: 'follow', actor: cat });
    const list = await Wishlist.create({ name: 'Bobs', owners: [bob] });
    const proposal = await Item.create({
      wishlist: list._id,
      name: 'Idea',
      status: 'proposed',
      proposedBy: ann,
    });
    await db().collection('sessions').insertOne({ sessionToken: 't', userId: annOid });
    await db().collection('accounts').insertOne({ userId: annOid, provider: 'nodemailer' });
    await db().collection('verification_tokens').insertOne({ identifier: 'ann@x.com', token: 'v' });
    const bobsSession = await db()
      .collection('sessions')
      .insertOne({ sessionToken: 'b', userId: new mongoose.Types.ObjectId(bob) });

    await eraseAnn();

    expect(await Follow.exists({ $or: [{ follower: ann }, { following: ann }] })).toBeNull();
    expect(await Follow.exists({ _id: bobFollowsCat._id })).toBeTruthy();
    expect(await Notification.exists({ $or: [{ user: ann }, { actor: ann }] })).toBeNull();
    expect(await Notification.exists({ _id: bobsOther._id })).toBeTruthy();
    const kept = await Item.findById(proposal._id).lean();
    expect(kept?.status).toBe('proposed');
    expect(kept?.proposedBy).toBeUndefined();
    expect(await db().collection('sessions').countDocuments({ userId: annOid })).toBe(0);
    expect(await db().collection('accounts').countDocuments({ userId: annOid })).toBe(0);
    expect(await db().collection('verification_tokens').countDocuments({})).toBe(0);
    expect(await db().collection('sessions').countDocuments({ _id: bobsSession.insertedId })).toBe(
      1
    );
    expect(await User.exists({ _id: ann })).toBeNull();
    expect(purge).toHaveBeenCalledWith({ userIds: [ann] });
  });

  it('can be finished by running it again after a failure part-way, and is a no-op once done', async () => {
    const mine = await Wishlist.create({ name: 'Mine', owners: [ann] });
    const shared = await Wishlist.create({ name: 'Ours', owners: [bob, ann] });
    await Follow.create({ follower: ann, following: bob });
    vi.spyOn(Follow, 'deleteMany').mockRejectedValueOnce(new Error('down'));

    await expect(eraseAnn()).rejects.toThrow('down');
    // Lists were settled before the failure; the account is still there.
    expect(await Wishlist.exists({ _id: mine._id })).toBeNull();
    expect((await Wishlist.findById(shared._id).lean())?.owners.map(String)).toEqual([bob]);
    expect(await User.exists({ _id: ann })).toBeTruthy();

    await eraseAnn();
    expect(await Follow.exists({ follower: ann })).toBeNull();
    expect(await User.exists({ _id: ann })).toBeNull();

    // Once more: nothing left to do, and nobody else's data moves.
    const before = await Wishlist.find({}).lean();
    await expect(eraseAnn()).resolves.toBe('deleted');
    expect(await Wishlist.find({}).lean()).toEqual(before);
  });
});

describe('deleteAccount: races on a list it owns', () => {
  it('regression: a co-owner joining just before the delete keeps the list, without the account', async () => {
    // The account read the list as its alone, then bob accepted an owner invite
    // before the delete landed. Deleting it would take bob's list from him.
    const list = await Wishlist.create({ name: 'Mine', owners: [ann] });
    const original = Wishlist.findOneAndDelete.bind(Wishlist);
    vi.spyOn(Wishlist, 'findOneAndDelete').mockImplementationOnce(((
      ...args: Parameters<typeof Wishlist.findOneAndDelete>
    ) => {
      return Wishlist.updateOne({ _id: list._id }, { $push: { owners: bob } }).then(() =>
        original(...args)
      );
    }) as never);

    await eraseAnn();

    const after = await Wishlist.findById(list._id).lean();
    expect(after?.owners.map(String)).toEqual([bob]);
  });

  it('regression: the other owner leaving at the same moment never leaves the list ownerless', async () => {
    // Both read the list as shared; bob's leave lands first, so the account's
    // removal is refused as the last owner, and the list is deleted instead.
    const list = await Wishlist.create({ name: 'Ours', owners: [ann, bob] });
    const original = Wishlist.updateOne.bind(Wishlist);
    vi.spyOn(Wishlist, 'updateOne').mockImplementationOnce(((
      ...args: Parameters<typeof Wishlist.updateOne>
    ) => {
      return original(
        { _id: list._id },
        { $pull: { owners: new mongoose.Types.ObjectId(bob) } }
      ).then(() => original(...args));
    }) as never);

    await eraseAnn();

    expect(await Wishlist.exists({ _id: list._id })).toBeNull();
    expect(await Wishlist.exists({ owners: { $size: 0 } })).toBeNull();
  });

  it('regression: never deletes a list the confirmation did not name, even one left to it mid-deletion', async () => {
    // The confirmation named no list (this one was shared then). Bob leaves while
    // the deletion runs, so the account becomes its only owner: it stops, with the
    // list kept and still owned, and the account there to confirm again.
    const list = await Wishlist.create({ name: 'Ours', owners: [ann, bob] });
    const original = Wishlist.updateOne.bind(Wishlist);
    vi.spyOn(Wishlist, 'updateOne').mockImplementationOnce(((
      ...args: Parameters<typeof Wishlist.updateOne>
    ) => {
      return original(
        { _id: list._id },
        { $pull: { owners: new mongoose.Types.ObjectId(bob) } }
      ).then(() => original(...args));
    }) as never);

    await expect(eraseAnn([])).rejects.toThrow();

    expect((await Wishlist.findById(list._id).lean())?.owners.map(String)).toEqual([ann]);
    expect(await User.exists({ _id: ann })).toBeTruthy();
  });

  it('regression: a booking that lands while it leaves as a member is freed by the second pass', async () => {
    const list = await Wishlist.create({ name: 'Bobs', owners: [bob] });
    await WishlistMember.create({ wishlist: list._id, user: ann });
    const item = await Item.create({ wishlist: list._id, name: 'Lamp' });
    // A booking in flight from another tab, written once the account has left.
    const original = Reservation.findOneAndDelete.bind(Reservation);
    let booked = false;
    vi.spyOn(Reservation, 'findOneAndDelete').mockImplementation(((
      ...args: Parameters<typeof Reservation.findOneAndDelete>
    ) => {
      if (booked) return original(...args);
      booked = true;
      return Item.updateOne({ _id: item._id }, { status: 'booked', bookedBy: ann }).then(() =>
        original(...args)
      );
    }) as never);

    await eraseAnn();

    const after = await Item.findById(item._id).lean();
    expect(after?.status).toBe('available');
    expect(after?.bookedBy).toBeNull();
  });
});
