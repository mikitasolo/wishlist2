import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { areFriends } from '@/lib/utils/friends';
import {
  isWishlistOwner,
  ownedByFilter,
  ownerIds,
  serializeWishlist,
} from '@/lib/utils/wishlistOwners';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { countWishlistItems, countsFor } from '@/lib/utils/wishlistItemCounts';

// GET /api/users/[id]/wishlists - Get wishlists for a specific user
// Returns: public wishlists + wishlists the current user has access to
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const { id: userId } = await params;

    await connectDB();

    // Check if target user exists
    const targetUser = isObjectIdParam(userId) ? await User.findById(userId) : null;
    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const viewerId = session?.user?.id || null;
    const isSelf = viewerId === userId;
    const isFriend = viewerId && !isSelf ? await areFriends(viewerId, userId) : false;

    // Enforce wishlist-list visibility ("who can see your wishlists"). This only
    // gates browsing the aggregate list on the profile; the profile itself stays
    // visible, and each wishlist's own visibility still governs direct access.
    if (targetUser.privacy?.profileVisibility === 'friends' && !isSelf && !isFriend) {
      return NextResponse.json(
        { success: false, error: 'These wishlists are private', restricted: true },
        { status: 403 }
      );
    }

    // Visibility tiers the viewer may see on a profile (archived lists excluded)
    const visibleTiers: ('everyone' | 'friends' | 'private')[] = ['everyone'];
    if (isFriend || isSelf) visibleTiers.push('friends');
    // Viewing your own profile shows everything, including private lists
    if (isSelf) visibleTiers.push('private');

    // Match by the stored visibility tier. A co-owned list shows on every
    // owner's profile, so "their lists" is an owners-set match.
    const visibleWishlists = await Wishlist.find({
      $and: [ownedByFilter(userId), { archived: { $ne: true }, visibility: { $in: visibleTiers } }],
    });

    // Plus any wishlist (any tier) where the viewer is an explicit member
    let memberWishlists: typeof visibleWishlists = [];
    if (viewerId) {
      const memberships = await WishlistMember.find({ user: viewerId });
      const wishlistIds = memberships.map((m) => m.wishlist);
      memberWishlists = await Wishlist.find({
        $and: [ownedByFilter(userId), { _id: { $in: wishlistIds }, archived: { $ne: true } }],
      });
    }

    // Plus any wishlist (any tier) the viewer co-owns. Co-owners have no
    // `WishlistMember` row, so the membership clause above misses them entirely:
    // without this, a private list you own with someone is invisible to you on
    // their profile. A list you own is never hidden from you by its own tier.
    let coOwnedWishlists: typeof visibleWishlists = [];
    if (viewerId && !isSelf) {
      coOwnedWishlists = await Wishlist.find({
        // Two `$or` filters, so they have to be combined under `$and`.
        $and: [ownedByFilter(userId), ownedByFilter(viewerId), { archived: { $ne: true } }],
      });
    }

    const allWishlists = [...visibleWishlists, ...memberWishlists, ...coOwnedWishlists];
    const uniqueWishlists = Array.from(
      new Map(allWishlists.map((w) => [w._id.toString(), w])).values()
    );

    // Which of these the viewer is a member of (membership carries no role).
    const viewerMemberships = new Set<string>();
    if (session?.user) {
      const memberships = await WishlistMember.find({
        user: session.user.id,
        wishlist: { $in: uniqueWishlists.map((w) => w._id) },
      });
      memberships.forEach((m) => viewerMemberships.add(m.wishlist.toString()));
    }

    // Get owner usernames for all wishlists (several per list when co-owned)
    const allOwnerIds = Array.from(new Set(uniqueWishlists.flatMap((w) => ownerIds(w))));
    const owners = await User.find({ _id: { $in: allOwnerIds } }).select('username image');
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o]));

    // Each list's item count is its published items (`lib/utils/itemCounts.ts`),
    // the same number every other screen shows for it. Drafts and proposals are
    // never counted here, not even on your own profile, and booking state is
    // never revealed (booked folds into the count), so the count is identical
    // whoever is looking.
    const counts = await countWishlistItems(uniqueWishlists.map((w) => w._id));

    // Add membership status, owner identities and item count to each wishlist.
    // The profile being viewed is shown as the owner, even on a co-owned list —
    // it's their profile — with the full set alongside for the card's "+N".
    const wishlistsWithMembership = uniqueWishlists.map((wishlist) => {
      const people = ownerIds(wishlist)
        .map((oid) => ownerMap.get(oid))
        .filter((o): o is NonNullable<typeof o> => !!o);
      const profileOwner = people.find((o) => o._id.toString() === userId) ?? people[0];
      // The viewer's own relationship to the list. On someone else's profile,
      // "owner" is what explains why a private list is visible at all.
      const viewerRole = isWishlistOwner(wishlist, viewerId)
        ? ('owner' as const)
        : viewerMemberships.has(wishlist._id.toString())
          ? ('member' as const)
          : null;
      return {
        ...serializeWishlist(wishlist, viewerId),
        // Suppressed on your own profile, where every list is yours and the
        // badge would just be uniform noise.
        userRole: isSelf ? null : viewerRole,
        ownerUsername: profileOwner?.username || null,
        ownerImage: profileOwner?.image ?? null,
        ownerUsernames: people.map((o) => o.username).filter((u): u is string => !!u),
        itemCount: countsFor(counts, wishlist._id).items,
      };
    });

    // Sort by creation date (newest first)
    wishlistsWithMembership.sort((a, b) => {
      const dateA = a.createdAt?.getTime() || 0;
      const dateB = b.createdAt?.getTime() || 0;
      return dateB - dateA;
    });

    return NextResponse.json({ success: true, data: wishlistsWithMembership }, { status: 200 });
  } catch (error) {
    console.error('Error fetching user wishlists:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch wishlists' },
      { status: 500 }
    );
  }
}
