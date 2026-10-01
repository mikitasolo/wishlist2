import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getFriendIds } from '@/lib/utils/friends';
import { getWishlistViewAccess, viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';

/**
 * Search can't run `getWishlistViewAccess` on every list it might return, so it
 * matches with `viewableWishlistsFilter`, the same rules as a query. This table
 * pins the two together: for every stored shape of a list (each visibility, and
 * each archived state, including an `archived` that's missing on an old
 * document) and every kind of viewer, the query matches a list exactly when
 * `getWishlistViewAccess` lets that viewer open it.
 */

const UNSET = Symbol('unset');
type Maybe<T> = T | typeof UNSET;

// Every list stores a `visibility` (the schema requires it), with the legacy
// `isPublic` beside it in sync (everyone ⇔ true), as every write sets them. A
// list with no stored `visibility` isn't a shape the database holds, so it's
// not in the table: hydrating one would fill in the schema default.
const VISIBILITIES = ['everyone', 'friends', 'private'] as const;
const ARCHIVED: Maybe<boolean>[] = [true, false, UNSET];

const VIEWERS = [
  'owner',
  'coOwner',
  'member',
  'friendOfOwner',
  'friendOfCoOwner',
  'follower',
  'stranger',
] as const;
const ids = {} as Record<(typeof VIEWERS)[number], mongoose.Types.ObjectId>;
let lists: { _id: mongoose.Types.ObjectId; shape: string }[] = [];

beforeAll(async () => {
  await connectTestDB();
  for (const name of VIEWERS) {
    const u = await User.create({ email: `${name}@x.com`, username: name.toLowerCase() });
    ids[name] = u._id;
  }
  const befriend = (a: mongoose.Types.ObjectId, b: mongoose.Types.ObjectId) =>
    Follow.create([
      { follower: a, following: b },
      { follower: b, following: a },
    ]);
  await befriend(ids.owner, ids.friendOfOwner);
  await befriend(ids.coOwner, ids.friendOfCoOwner);
  // Follows the owner, who doesn't follow back: not a friend.
  await Follow.create({ follower: ids.follower, following: ids.owner });

  // Raw inserts, so a field can be truly missing, the way it is on an old document.
  const docs: Record<string, unknown>[] = [];
  for (const visibility of VISIBILITIES) {
    for (const archived of ARCHIVED) {
      const doc: Record<string, unknown> = {
        _id: new mongoose.Types.ObjectId(),
        name: 'List',
        owners: [ids.owner, ids.coOwner],
        featuredBy: [],
        visibility,
        isPublic: visibility === 'everyone',
      };
      if (archived !== UNSET) doc.archived = archived;
      docs.push(doc);
    }
  }
  await Wishlist.collection.insertMany(docs);
  await WishlistMember.insertMany(docs.map((d) => ({ wishlist: d._id, user: ids.member })));
  lists = docs.map((d) => ({
    _id: d._id as mongoose.Types.ObjectId,
    shape: JSON.stringify({
      visibility: d.visibility,
      archived: d.archived ?? '(unset)',
    }),
  }));
});

afterAll(disconnectTestDB);

/** The lists `getWishlistViewAccess` lets `viewerId` open, as the routes see them (hydrated). */
async function openable(viewerId: string | null): Promise<string[]> {
  const allowed: string[] = [];
  for (const { _id, shape } of lists) {
    const wishlist = await Wishlist.findById(_id);
    if ((await getWishlistViewAccess(wishlist!, viewerId)).allowed) allowed.push(shape);
  }
  return allowed.sort();
}

/** The lists `viewableWishlistsFilter` matches for `viewerId`, through an uncast `$match`. */
async function matched(viewerId: string | null): Promise<string[]> {
  const viewer = viewerId
    ? {
        id: viewerId,
        memberOf: await WishlistMember.distinct('wishlist', { user: viewerId }),
        friendIds: await getFriendIds(viewerId),
      }
    : null;
  const rows = await Wishlist.aggregate<{ _id: mongoose.Types.ObjectId }>([
    { $match: viewableWishlistsFilter(viewer) },
    { $project: { _id: 1 } },
  ]);
  const byId = new Map(lists.map((l) => [l._id.toString(), l.shape]));
  return rows.map((r) => byId.get(r._id.toString())!).sort();
}

describe('viewableWishlistsFilter matches exactly what getWishlistViewAccess opens', () => {
  const viewers: [string, () => string | null][] = [
    ['signed out', () => null],
    ['an owner', () => ids.owner.toString()],
    ['a co-owner', () => ids.coOwner.toString()],
    ['a member', () => ids.member.toString()],
    ['a friend of the owner', () => ids.friendOfOwner.toString()],
    ['a friend of the co-owner', () => ids.friendOfCoOwner.toString()],
    ['a one-way follower', () => ids.follower.toString()],
    ['a stranger', () => ids.stranger.toString()],
  ];

  it('covers every stored shape', () => {
    expect(lists).toHaveLength(VISIBILITIES.length * ARCHIVED.length);
  });

  it.each(viewers)('for %s', async (_label, viewer) => {
    const expected = await openable(viewer());
    expect(await matched(viewer())).toEqual(expected);
  });

  // Guards the table against passing vacuously (say, if both sides matched nothing).
  it('lets an owner open every list and a stranger only some', async () => {
    expect(await openable(ids.owner.toString())).toHaveLength(lists.length);
    const strangers = await openable(ids.stranger.toString());
    expect(strangers.length).toBeGreaterThan(0);
    expect(strangers.length).toBeLessThan(lists.length);
  });
});
