import { NextRequest, NextResponse } from 'next/server';
import mongoose, { type FilterQuery, type PipelineStage } from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { enforce, ipKey } from '@/lib/rateLimit';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { ownedByFilter, primaryOwnerId } from '@/lib/utils/wishlistOwners';
import { viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';

/** Results per section. */
const LIMIT = 6;

type ObjectId = mongoose.Types.ObjectId;

/** The signed-in searcher's follow graph and memberships, which scope and rank results. */
interface Searcher {
  id: string;
  oid: ObjectId;
  following: ObjectId[];
  followers: ObjectId[];
  /** Mutual follows. */
  friends: ObjectId[];
  /** Lists they're a member of. */
  memberOf: ObjectId[];
}

async function loadSearcher(id: string): Promise<Searcher> {
  const oid = new mongoose.Types.ObjectId(id);
  const [following, followers, memberOf] = await Promise.all([
    Follow.distinct('following', { follower: oid }),
    Follow.distinct('follower', { following: oid }),
    WishlistMember.distinct('wishlist', { user: oid }),
  ]);
  const followsMe = new Set(followers.map(String));
  const friends = following.filter((f) => followsMe.has(String(f)));
  return { id, oid, following, followers, friends, memberOf };
}

/** 0 when the field starts with the query, 1 when it only contains it. */
function substringRank(field: string, prefix: RegExp) {
  return { $cond: [{ $regexMatch: { input: field, regex: prefix } }, 0, 1] };
}

/**
 * People whose username contains the query. `privacy.searchable: false` hides
 * someone from everyone, friends included. Ranked: exact username, friends,
 * people you follow, your followers, everyone else; then a prefix match before
 * a substring match; then by username.
 */
function searchPeople(q: string, rx: RegExp, prefix: RegExp, searcher: Searcher | null) {
  const branches: { case: unknown; then: number }[] = [
    { case: { $eq: ['$username', q] }, then: 0 },
  ];
  if (searcher) {
    branches.push(
      { case: { $in: ['$_id', searcher.friends] }, then: 1 },
      { case: { $in: ['$_id', searcher.following] }, then: 2 },
      { case: { $in: ['$_id', searcher.followers] }, then: 3 }
    );
  }
  return User.aggregate<{ username: string; image?: string | null }>([
    { $match: { username: rx, 'privacy.searchable': { $ne: false } } },
    {
      $addFields: {
        _tier: { $switch: { branches, default: 4 } },
        _substring: substringRank('$username', prefix),
      },
    },
    { $sort: { _tier: 1, _substring: 1, username: 1 } },
    { $limit: LIMIT },
    { $project: { _id: 0, username: 1, image: 1 } },
  ]);
}

/**
 * Lists whose name contains the query, out of the ones the searcher may open
 * (`viewableWishlistsFilter`, the query form of `getWishlistViewAccess`).
 *
 * A list the searcher doesn't own or belong to also has to get past every
 * owner's `profileVisibility`: an owner who shows their wishlists to friends
 * only keeps their lists out of a non-friend's results, as on their profile.
 *
 * Ranked: lists you own or are a member of, friends' lists (any owner is a
 * friend), everyone else's; then a prefix match before a substring match; then
 * the most recently updated.
 */
async function searchWishlists(rx: RegExp, prefix: RegExp, searcher: Searcher | null) {
  const scope: FilterQuery<IWishlist> = {
    $and: [
      { name: rx },
      viewableWishlistsFilter(
        searcher && { id: searcher.id, memberOf: searcher.memberOf, friendIds: searcher.friends }
      ),
    ],
  };

  // Owners of the matching lists who hide their wishlists from this searcher.
  const candidateOwners = await Wishlist.distinct('owners', scope);
  const hidingOwners = await User.distinct('_id', {
    _id: { $in: candidateOwners, $nin: searcher ? [searcher.oid, ...searcher.friends] : [] },
    'privacy.profileVisibility': 'friends',
  });
  const insider: FilterQuery<IWishlist>[] = searcher
    ? [ownedByFilter(searcher.id), { _id: { $in: searcher.memberOf } }]
    : [];
  const match: FilterQuery<IWishlist> =
    hidingOwners.length === 0
      ? scope
      : { $and: [scope, { $or: [...insider, { owners: { $nin: hidingOwners } }] }] };

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

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $addFields: { _tier: tier, _substring: substringRank('$name', prefix) } },
    { $sort: { _tier: 1, _substring: 1, updatedAt: -1, _id: 1 } },
    { $limit: LIMIT },
    { $project: { name: 1, slug: 1, owners: 1 } },
  ];
  return Wishlist.aggregate<Pick<IWishlist, '_id' | 'name' | 'slug' | 'owners'>>(pipeline);
}

// GET /api/search?q=... - unified search over usernames + the wishlists the
// searcher may open, ranked by how close each result is to them.
export async function GET(request: NextRequest) {
  try {
    // Public endpoint — key on IP to blunt graph scraping.
    const limited = await enforce('search', ipKey(request.headers));
    if (limited) return limited;

    const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 1) {
      return NextResponse.json({ success: true, data: { users: [], wishlists: [] } });
    }

    await connectDB();

    // Escape regex special chars, match as a substring (case-insensitive)
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const prefix = new RegExp(`^${escaped}`, 'i');

    const session = await auth();
    const searcher = session?.user?.id ? await loadSearcher(session.user.id) : null;

    const [users, wishlists] = await Promise.all([
      searchPeople(q, rx, prefix, searcher),
      searchWishlists(rx, prefix, searcher),
    ]);

    // Resolve the primary owner's username for the matched wishlists — the
    // result row has space for one name, and co-owners are listed on the list itself.
    const primaryIds = wishlists.map((w) => primaryOwnerId(w)).filter((id): id is string => !!id);
    const owners = await User.find({ _id: { $in: Array.from(new Set(primaryIds)) } }).select(
      'username'
    );
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.username]));

    return NextResponse.json({
      success: true,
      data: {
        users: users.map((u) => ({ username: u.username, image: u.image ?? null })),
        wishlists: wishlists.map((w) => ({
          _id: w._id,
          name: w.name,
          slug: w.slug ?? null,
          ownerUsername: ownerMap.get(primaryOwnerId(w) ?? '') || null,
        })),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
