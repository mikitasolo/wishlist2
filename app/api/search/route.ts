import { NextRequest, NextResponse } from 'next/server';
import mongoose, { type PipelineStage } from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { enforce, ipKey } from '@/lib/rateLimit';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getFriendIds } from '@/lib/utils/friends';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';
import { viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';
import { usernameQuery } from '@/lib/utils/searchQuery';
import type { ListRelation, PersonRelation } from '@/lib/utils/searchRelations';

/** Results per section. */
const LIMIT = 6;

type ObjectId = mongoose.Types.ObjectId;

/** The signed-in searcher's follow graph and memberships, which scope and rank results. */
interface Searcher {
  id: string;
  oid: ObjectId;
  following: ObjectId[];
  followers: ObjectId[];
  /** Mutual follows, from `getFriendIds` like every other friends check. */
  friends: ObjectId[];
  /** Lists they're a member of. Only the list section reads it: empty when that's skipped. */
  memberOf: ObjectId[];
}

/** `lists`: whether the request runs the list section, so its memberships are read. */
async function loadSearcher(id: string, lists: boolean): Promise<Searcher> {
  const oid = new mongoose.Types.ObjectId(id);
  const [following, followers, friendIds, memberOf] = await Promise.all([
    Follow.distinct('following', { follower: oid }),
    Follow.distinct('follower', { following: oid }),
    getFriendIds(oid),
    lists ? WishlistMember.distinct('wishlist', { user: oid }) : [],
  ]);
  // Aggregation expressions don't cast, so every id has to be an ObjectId.
  const friends = friendIds.map((f) => new mongoose.Types.ObjectId(f));
  return { id, oid, following, followers, friends, memberOf };
}

/** Case-insensitive patterns for `term` as plain text: anywhere in a field, and at its start. */
function matchers(term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { rx: new RegExp(escaped, 'i'), prefix: new RegExp(`^${escaped}`, 'i') };
}

/** 0 when the field starts with the query, 1 when it only contains it. */
function substringRank(field: string, prefix: RegExp) {
  return { $cond: [{ $regexMatch: { input: field, regex: prefix } }, 0, 1] };
}

/** `relation` is only ever the searcher's own (`lib/utils/searchRelations.ts`). */
type PersonRow = { username: string; image?: string | null; relation: PersonRelation | null };

/**
 * People whose username contains the query, without a leading `@`
 * (`usernameQuery`), so `@alice` finds alice. Nobody for a bare `@`.
 * `privacy.searchable: false` hides someone from everyone, friends included,
 * and the searcher never finds themselves (their own lists still come up).
 *
 * Ranked by how well the username matches first: the exact username, then
 * prefix matches, then substring matches (WIS-271). Within each, friends,
 * people you follow, your followers, then everyone else; then by username.
 */
async function searchPeople(q: string, searcher: Searcher | null): Promise<PersonRow[]> {
  const term = usernameQuery(q);
  if (!term) return [];
  const { rx, prefix } = matchers(term);
  const tiers: { case: unknown; then: number }[] = searcher
    ? [
        { case: { $in: ['$_id', searcher.friends] }, then: 0 },
        { case: { $in: ['$_id', searcher.following] }, then: 1 },
        { case: { $in: ['$_id', searcher.followers] }, then: 2 },
      ]
    : [];
  const relation = searcher
    ? {
        $switch: {
          branches: [
            { case: { $in: ['$_id', searcher.friends] }, then: 'friend' },
            {
              case: {
                $and: [
                  { $in: ['$_id', searcher.followers] },
                  { $not: [{ $in: ['$_id', searcher.following] }] },
                ],
              },
              then: 'follows_you',
            },
          ],
          default: null,
        },
      }
    : { $literal: null };
  const match: Record<string, unknown> = { username: rx, 'privacy.searchable': { $ne: false } };
  if (searcher) match._id = { $ne: searcher.oid };
  return User.aggregate<PersonRow>([
    { $match: match },
    {
      $addFields: {
        _match: {
          $cond: [
            // `$literal`, or a query starting with `$` would be read as a field path.
            { $eq: ['$username', { $literal: term }] },
            0,
            { $add: [1, substringRank('$username', prefix)] },
          ],
        },
        _tier: tiers.length ? { $switch: { branches: tiers, default: 3 } } : { $literal: 3 },
      },
    },
    { $sort: { _match: 1, _tier: 1, username: 1 } },
    { $limit: LIMIT },
    { $project: { _id: 0, username: 1, image: 1, relation } },
  ]);
}

/**
 * Lists whose name contains the query, out of the ones the searcher may open
 * (`viewableWishlistsFilter`, the query form of `getWishlistViewAccess`).
 *
 * Ranked: lists you own or are a member of, friends' lists (any owner is a
 * friend), everyone else's; then a prefix match before a substring match; then
 * the most recently updated.
 *
 * A list outside the first tier also has to get past every owner's
 * `profileVisibility`: an owner who shows their wishlists to friends only keeps
 * their lists out of a non-friend's results, as on their profile.
 */
function searchWishlists(rx: RegExp, prefix: RegExp, searcher: Searcher | null) {
  const owners = { $ifNull: ['$owners', []] };
  const tier = searcher
    ? {
        $switch: {
          branches: [
            {
              case: {
                $or: [{ $in: [searcher.oid, owners] }, { $in: ['$_id', searcher.memberOf] }],
              },
              then: 0,
            },
            {
              case: { $gt: [{ $size: { $setIntersection: [owners, searcher.friends] } }, 0] },
              then: 1,
            },
          ],
          default: 2,
        },
      }
    : { $literal: 2 };
  // Whose lists a friends-only profile never hides from the searcher: their own and their friends'.
  const unhidden = searcher ? [searcher.oid, ...searcher.friends] : [];
  // The searcher's own relation to the list, and no one else's.
  const relation = searcher
    ? {
        $switch: {
          branches: [
            { case: { $in: [searcher.oid, owners] }, then: 'owner' },
            { case: { $in: ['$_id', searcher.memberOf] }, then: 'member' },
          ],
          default: null,
        },
      }
    : { $literal: null };
  const viewer = searcher && {
    id: searcher.id,
    memberOf: searcher.memberOf,
    friendIds: searcher.friends,
  };

  const pipeline: PipelineStage[] = [
    { $match: { $and: [{ name: rx }, viewableWishlistsFilter(viewer)] } },
    { $addFields: { _tier: tier, _substring: substringRank('$name', prefix) } },
    {
      $lookup: {
        from: User.collection.collectionName,
        localField: 'owners',
        foreignField: '_id',
        as: '_owners',
      },
    },
    {
      $match: {
        $or: [
          { _tier: 0 },
          {
            _owners: {
              $not: {
                $elemMatch: { 'privacy.profileVisibility': 'friends', _id: { $nin: unhidden } },
              },
            },
          },
        ],
      },
    },
    { $sort: { _tier: 1, _substring: 1, updatedAt: -1, _id: 1 } },
    { $limit: LIMIT },
    { $project: { name: 1, slug: 1, owners: 1, relation } },
  ];
  return Wishlist.aggregate<
    Pick<IWishlist, '_id' | 'name' | 'slug' | 'owners'> & { relation: ListRelation | null }
  >(pipeline);
}

// GET /api/search?q=... - unified search over usernames + the wishlists the
// searcher may open, ranked by how well each matches, then by how close it is
// to them. Each result carries `relation`, the searcher's own relation to it
// (null signed out, or when there's none).
// `&sections=users` searches people only (the invite form's username
// suggestions): `wishlists` comes back empty, and nothing only the list section
// needs is read. Absent, or any other value, it's both sections.
export async function GET(request: NextRequest) {
  try {
    // Public endpoint — key on IP to blunt graph scraping.
    const limited = await enforce('search', ipKey(request.headers));
    if (limited) return limited;

    const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
    const lists = request.nextUrl.searchParams.get('sections') !== 'users';
    if (q.length < 1) {
      return NextResponse.json({ success: true, data: { users: [], wishlists: [] } });
    }

    await connectDB();

    // List names match the query as typed (`searchPeople` drops a leading `@`).
    const { rx, prefix } = matchers(q);

    const session = await auth();
    const searcher = session?.user?.id ? await loadSearcher(session.user.id, lists) : null;

    const [users, wishlists] = await Promise.all([
      searchPeople(q, searcher),
      lists ? searchWishlists(rx, prefix, searcher) : [],
    ]);

    // Resolve the primary owner's username for the matched wishlists — the
    // result row has space for one name, and co-owners are listed on the list itself.
    const primaryIds = wishlists.map((w) => primaryOwnerId(w)).filter((id): id is string => !!id);
    const owners = primaryIds.length
      ? await User.find({ _id: { $in: Array.from(new Set(primaryIds)) } }).select('username')
      : [];
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.username]));

    return NextResponse.json({
      success: true,
      data: {
        users: users.map((u) => ({
          username: u.username,
          image: u.image ?? null,
          relation: u.relation ?? null,
        })),
        wishlists: wishlists.map((w) => ({
          _id: w._id,
          name: w.name,
          slug: w.slug ?? null,
          ownerUsername: ownerMap.get(primaryOwnerId(w) ?? '') || null,
          relation: w.relation ?? null,
        })),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
