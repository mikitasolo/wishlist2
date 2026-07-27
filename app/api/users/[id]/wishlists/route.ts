import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import mongoose from 'mongoose';
import { areFriends } from '@/lib/utils/friends';
import { ownedByFilter, ownerIds, serializeWishlist } from '@/lib/utils/wishlistOwners';

// GET /api/users/[id]/wishlists - Get wishlists for a specific user
// Returns: public wishlists + wishlists the current user has access to
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const { id: userId } = await params;

    await connectDB();

    // Check if target user exists
    const targetUser = await User.findById(userId);
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

    // Match by visibility tier, tolerating legacy docs that predate the field
    // (no `visibility` + isPublic:true ⇒ treated as everyone). A co-owned list
    // shows on every owner's profile, so "their lists" is an owners-set match.
    const orClauses: Record<string, unknown>[] = [{ visibility: { $in: visibleTiers } }];
    if (visibleTiers.includes('everyone')) {
      orClauses.push({ visibility: { $exists: false }, isPublic: true });
    }
    const visibleWishlists = await Wishlist.find({
      // ownedByFilter is itself an `$or`, so both must be combined under `$and`.
      $and: [ownedByFilter(userId), { archived: { $ne: true }, $or: orClauses }],
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

    const allWishlists = [...visibleWishlists, ...memberWishlists];
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

    // Privacy-safe item count: only "real" list items are counted
    // (available / booked / completed). Draft and proposed items stay hidden,
    // and booking state is never revealed (booked is folded into the total) —
    // this keeps the count identical whether you view your own profile or
    // someone else's, never spoiling which gifts have been reserved.
    const visibleCounts = await Item.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      {
        $match: {
          wishlist: { $in: uniqueWishlists.map((w) => w._id) },
          status: { $in: ['available', 'booked', 'completed'] },
        },
      },
      { $group: { _id: '$wishlist', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(visibleCounts.map((c) => [c._id.toString(), c.count]));

    // Add membership status, owner identities and item count to each wishlist.
    // The profile being viewed is shown as the owner, even on a co-owned list —
    // it's their profile — with the full set alongside for the card's "+N".
    const wishlistsWithMembership = uniqueWishlists.map((wishlist) => {
      const people = ownerIds(wishlist)
        .map((oid) => ownerMap.get(oid))
        .filter((o): o is NonNullable<typeof o> => !!o);
      const profileOwner = people.find((o) => o._id.toString() === userId) ?? people[0];
      return {
        ...serializeWishlist(wishlist, viewerId),
        userRole: viewerMemberships.has(wishlist._id.toString()) ? ('member' as const) : null,
        ownerUsername: profileOwner?.username || null,
        ownerImage: profileOwner?.image ?? null,
        ownerUsernames: people.map((o) => o.username).filter((u): u is string => !!u),
        itemCount: countMap.get(wishlist._id.toString()) ?? 0,
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
