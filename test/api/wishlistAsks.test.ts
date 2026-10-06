import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// WIS-324: asking a friend to make a wishlist. Friends only, when the asker can
// open none of the person's lists; one ask per 30 days that quietly expires;
// the askers who can open a new list are told about it, and nobody else.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendNotificationEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: vi.fn(),
  sendNotificationEmail: (...a: unknown[]) => sendNotificationEmail(...a),
}));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as askState, POST as askRoute } from '@/app/api/users/[id]/ask/route';
import { POST as createList } from '@/app/api/wishlists/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistAsk from '@/models/WishlistAsk';
import Notification from '@/models/Notification';
import { notifyAskersOfNewList, WISHLIST_ASK_WINDOW_MS } from '@/lib/utils/wishlistAsks';

const session = vi.mocked(auth);

const denyAll: RateLimiter = {
  async limit() {
    return { success: false, reset: Date.now() + 60_000, limit: 10, remaining: 0 };
  },
};

let anna: string; // the person asked
let ivan: string; // a friend of anna's, who asks
let olga: string; // another friend of anna's
let max: string; // follows anna, but she doesn't follow back

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

const befriend = async (a: string, b: string) => {
  await Follow.create({ follower: a, following: b });
  await Follow.create({ follower: b, following: a });
};

beforeEach(async () => {
  await clearTestDB();
  await WishlistAsk.createIndexes();
  session.mockReset();
  sendNotificationEmail.mockReset();
  const make = async (username: string) =>
    (await User.create({ email: `${username}@secret.com`, username }))._id.toString();
  anna = await make('anna');
  ivan = await make('ivan');
  olga = await make('olga');
  max = await make('max');
  await befriend(anna, ivan);
  await befriend(anna, olga);
  await Follow.create({ follower: max, following: anna });
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

const as = (userId: string | null) =>
  session.mockResolvedValue(
    (userId
      ? { user: { id: userId, username: userId === ivan ? 'ivan' : 'someone' } }
      : null) as never
  );
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });

function askAs(userId: string | null, person = anna) {
  as(userId);
  return askRoute(req(`/api/users/${person}/ask`, 'POST'), ctx(person));
}
async function askedBy(userId: string, person = anna): Promise<boolean> {
  as(userId);
  const res = await askState(req(`/api/users/${person}/ask`, 'GET'), ctx(person));
  return (await res.json()).data.asked;
}
async function annaMakes(visibility: 'everyone' | 'friends' | 'private', name = 'Birthday') {
  session.mockResolvedValue({ user: { id: anna, username: 'anna' } } as never);
  const res = await createList(req('/api/wishlists', 'POST', { name, visibility }));
  expect(res.status).toBe(201);
  return (await res.json()).data._id as string;
}
const asksTo = (user: string) => Notification.find({ user, type: 'wishlist_ask' }).lean();
const madeFor = (user: string) => Notification.find({ user, type: 'asked_list_made' }).lean();

describe('POST /api/users/[id]/ask: who may ask', () => {
  it('refuses a signed-out caller', async () => {
    expect((await askAs(null)).status).toBe(401);
  });

  it('refuses asking yourself, and an unknown or malformed id', async () => {
    expect((await askAs(anna)).status).toBe(400);
    expect((await askAs(ivan, new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect((await askAs(ivan, 'nope')).status).toBe(404);
  });

  it('refuses anyone who is not a friend (a one-way follow included), telling nobody', async () => {
    const res = await askAs(max);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('You can only ask friends for a wishlist');
    expect(await WishlistAsk.countDocuments()).toBe(0);
    expect(await Notification.countDocuments({ type: 'wishlist_ask' })).toBe(0);
  });

  it('refuses a friend who can already open one of their lists', async () => {
    await Wishlist.create({ name: 'Ideas', owners: [anna], visibility: 'friends' });
    const res = await askAs(ivan);
    expect(res.status).toBe(409);
    expect(await WishlistAsk.countDocuments()).toBe(0);
  });

  it('counts a list co-owned with someone else, and one the friend is a member of', async () => {
    const shared = await Wishlist.create({
      name: 'Shared',
      owners: [olga, anna],
      visibility: 'private',
    });
    await WishlistMember.create({ wishlist: shared._id, user: ivan });
    expect((await askAs(ivan)).status).toBe(409);
  });

  it('lets a friend ask when every list is private or archived', async () => {
    await Wishlist.create({ name: 'Secret', owners: [anna], visibility: 'private' });
    await Wishlist.create({ name: 'Old', owners: [anna], visibility: 'everyone', archived: true });
    expect((await askAs(ivan)).status).toBe(201);
  });

  it('is rate-limited per asker, only once the caller may ask', async () => {
    __setRateLimiters({ wishlistAsk: denyAll });
    // A non-friend is refused as such, not by the limit.
    expect((await askAs(max)).status).toBe(403);
    expect((await askAs(ivan)).status).toBe(429);
    expect(await WishlistAsk.countDocuments()).toBe(0);
  });
});

describe('POST /api/users/[id]/ask: the ask', () => {
  it('records it and tells only the person, naming the asker by handle', async () => {
    const res = await askAs(ivan);
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ asked: true });

    const rows = await Notification.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'wishlist_ask', actorUsername: 'ivan', read: false });
    expect(rows[0].user.toString()).toBe(anna);
    expect(rows[0].actor?.toString()).toBe(ivan);
    expect(rows[0].wishlist).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain('@secret.com');
  });

  it('shows Asked to the asker only', async () => {
    await askAs(ivan);
    expect(await askedBy(ivan)).toBe(true);
    expect(await askedBy(olga)).toBe(false);
    expect(await askedBy(anna, ivan)).toBe(false);
  });

  it('asks once per 30 days: again is answered as asked, telling nobody twice', async () => {
    await askAs(ivan);
    const again = await askAs(ivan);
    expect(again.status).toBe(200);
    expect((await again.json()).data).toEqual({ asked: true });
    expect(await asksTo(anna)).toHaveLength(1);
    expect(await WishlistAsk.countDocuments()).toBe(1);
  });

  it('quietly expires after 30 days, when the friend may ask again', async () => {
    await askAs(ivan);
    await WishlistAsk.updateOne(
      { asker: ivan },
      { $set: { askedAt: new Date(Date.now() - WISHLIST_ASK_WINDOW_MS - 1000) } }
    );
    expect(await askedBy(ivan)).toBe(false);
    expect((await askAs(ivan)).status).toBe(201);
    expect(await asksTo(anna)).toHaveLength(2);
    expect(await WishlistAsk.countDocuments()).toBe(1);
  });

  it('regression: two asks at once land once and tell the person once', async () => {
    const [a, b] = await Promise.all([askAs(ivan), askAs(ivan)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await asksTo(anna)).toHaveLength(1);
    expect(await WishlistAsk.countDocuments()).toBe(1);
  });

  it('regression: takes the ask back when a list they can open appears as it is written', async () => {
    const hold = holdFirstCall(
      WishlistAsk,
      'updateOne',
      () => Wishlist.create({ name: 'Just made', owners: [anna], visibility: 'friends' }),
      { after: true }
    );
    const res = await askAs(ivan);
    expect(hold.held()).toBe(true);
    expect(res.status).toBe(409);
    expect(await WishlistAsk.countDocuments()).toBe(0);
    expect(await asksTo(anna)).toHaveLength(0);
  });

  it('regression: takes the ask back when the friendship ends as it is written', async () => {
    const hold = holdFirstCall(
      WishlistAsk,
      'updateOne',
      () => Follow.deleteOne({ follower: anna, following: ivan }),
      { after: true }
    );
    expect((await askAs(ivan)).status).toBe(403);
    expect(hold.held()).toBe(true);
    expect(await WishlistAsk.countDocuments()).toBe(0);
    expect(await asksTo(anna)).toHaveLength(0);
  });

  it('holds back only the notification at the person’s limit: the ask stands, and the asker can’t tell', async () => {
    __setRateLimiters({ wishlistAskReceived: denyAll });
    const res = await askAs(ivan);
    expect(res.status).toBe(201);
    expect(await askedBy(ivan)).toBe(true);
    expect(await asksTo(anna)).toHaveLength(0);
  });

  it('emails the person only when they turned the email on (off by default)', async () => {
    await askAs(ivan);
    expect(sendNotificationEmail).not.toHaveBeenCalled();

    await User.updateOne({ _id: anna }, { $set: { 'notificationPrefs.wishlist_ask.email': true } });
    await askAs(olga);
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    const [to, details] = sendNotificationEmail.mock.calls[0];
    expect(to).toBe('anna@secret.com');
    expect(details).toMatchObject({ type: 'wishlist_ask', recipientId: anna, wishlistId: null });
  });

  it('skips the in-app row for someone who turned it off', async () => {
    await User.updateOne(
      { _id: anna },
      { $set: { 'notificationPrefs.wishlist_ask.inApp': false } }
    );
    expect((await askAs(ivan)).status).toBe(201);
    expect(await asksTo(anna)).toHaveLength(0);
  });
});

describe('a new list tells the askers who can open it', () => {
  it('tells an asker about a list they can open, once, and answers their ask', async () => {
    await askAs(ivan);
    const listId = await annaMakes('friends');

    const rows = await madeFor(ivan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUsername: 'anna', wishlistName: 'Birthday' });
    expect(rows[0].wishlist?.toString()).toBe(listId);
    expect(rows[0].actor?.toString()).toBe(anna);
    expect(await askedBy(ivan)).toBe(false);

    // A second list tells nobody again.
    await annaMakes('everyone', 'Christmas');
    expect(await madeFor(ivan)).toHaveLength(1);
  });

  it('tells an asker who can’t open it nothing, and keeps their ask for a later list', async () => {
    await askAs(ivan);
    await annaMakes('private');
    expect(await madeFor(ivan)).toHaveLength(0);
    expect(await askedBy(ivan)).toBe(true);

    await annaMakes('friends', 'Ideas');
    expect(await madeFor(ivan)).toHaveLength(1);
  });

  it('tells each asker only about their own ask, and only those who can open the list', async () => {
    await askAs(ivan);
    await askAs(olga);
    // Olga is no longer anna's friend: a friends-only list isn't hers to open.
    await Follow.deleteOne({ follower: anna, following: olga });
    await annaMakes('friends');

    expect(await madeFor(ivan)).toHaveLength(1);
    expect(await madeFor(olga)).toHaveLength(0);
    expect(await Notification.countDocuments({ type: 'asked_list_made' })).toBe(1);
    // Anna herself learns nothing about who was told.
    expect(await madeFor(anna)).toHaveLength(0);
  });

  it('ignores an expired ask', async () => {
    await askAs(ivan);
    await WishlistAsk.updateOne(
      { asker: ivan },
      { $set: { askedAt: new Date(Date.now() - WISHLIST_ASK_WINDOW_MS - 1000) } }
    );
    await annaMakes('everyone');
    expect(await madeFor(ivan)).toHaveLength(0);
  });

  it('regression: takes the row back when the list stops being open to them as it is written', async () => {
    await askAs(ivan);
    const list = await Wishlist.create({ name: 'Quick', owners: [anna], visibility: 'friends' });
    // The list goes private once the asker's row is written, before the re-check.
    const hold = holdFirstCall(
      Notification,
      'create',
      () => Wishlist.updateOne({ _id: list._id }, { $set: { visibility: 'private' } }),
      { after: true }
    );
    await User.updateOne(
      { _id: ivan },
      { $set: { 'notificationPrefs.asked_list_made.email': true } }
    );
    await notifyAskersOfNewList(list, anna, 'anna');
    expect(hold.held()).toBe(true);

    expect(await madeFor(ivan)).toHaveLength(0);
    expect(sendNotificationEmail).not.toHaveBeenCalled();
    // Their ask stands again, for a list they can open.
    expect(await askedBy(ivan)).toBe(true);
  });

  it('emails an asker who turned it on, about the list it names', async () => {
    await askAs(ivan);
    await User.updateOne(
      { _id: ivan },
      { $set: { 'notificationPrefs.asked_list_made.email': true } }
    );
    const listId = await annaMakes('everyone');
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(sendNotificationEmail.mock.calls[0][1]).toMatchObject({
      type: 'asked_list_made',
      recipientId: ivan,
      wishlistId: listId,
      actorUsername: 'anna',
    });
  });
});
