import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import { generateUniqueWishlistSlug } from '@/lib/utils/wishlistSlug';
import mongoose from 'mongoose';
import { createWishlistSchema, validateRequestBody } from '@/lib/validations';
import { ownedByFilter, ownerIds, serializeWishlist } from '@/lib/utils/wishlistOwners';

// GET /api/wishlists - Get all wishlists user has access to
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    await connectDB();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 });
    }

    // Get all wishlists the user co-owns, sorted by creation date
    const ownedWishlists = await Wishlist.find(ownedByFilter(user._id.toString())).sort({
      createdAt: -1,
    });

    // Get all wishlists where user is a member (not owner)
    const memberships = await WishlistMember.find({ user: user._id });
    const wishlistIds = memberships.map((m) => m.wishlist);
    // Archived wishlists are hidden from members — only the owner still sees them.
    const memberWishlists = await Wishlist.find({
      _id: { $in: wishlistIds },
      archived: { $ne: true },
    }).sort({ createdAt: -1 });

    // Filter out owned wishlists from member wishlists (in case user is both owner and member)
    const ownedWishlistIds = new Set(ownedWishlists.map((w) => w._id.toString()));
    const memberOnlyWishlists = memberWishlists.filter(
      (w) => !ownedWishlistIds.has(w._id.toString())
    );

    // Resolve every owner's public identity (never their email). A co-owned list
    // has several; `ownerUsernames` keeps them all and the card shows the first
    // plus a count.
    const allWishlistOwners = new Set(
      [...ownedWishlists, ...memberOnlyWishlists].flatMap((w) => ownerIds(w))
    );
    const owners = await User.find({ _id: { $in: Array.from(allWishlistOwners) } }).select(
      'username image'
    );
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o]));
    const ownerFields = (w: (typeof ownedWishlists)[number]) => {
      const people = ownerIds(w)
        .map((id) => ownerMap.get(id))
        .filter((o): o is NonNullable<typeof o> => !!o);
      return {
        ownerUsername: people[0]?.username || null,
        ownerImage: people[0]?.image ?? null,
        ownerUsernames: people.map((o) => o.username).filter((u): u is string => !!u),
      };
    };

    // Compute a privacy-safe item count per wishlist.
    // We deliberately never expose booking state here (owners must not learn
    // which of their items have been booked). `total` counts every item;
    // `nonDraft` excludes owner-only draft items so members don't learn that
    // hidden drafts exist. Owned lists use `total`; member lists use `nonDraft`.
    const allWishlistIds = [
      ...ownedWishlists.map((w) => w._id),
      ...memberOnlyWishlists.map((w) => w._id),
    ];
    const countAgg = await Item.aggregate<{
      _id: mongoose.Types.ObjectId;
      total: number;
      nonDraft: number;
    }>([
      { $match: { wishlist: { $in: allWishlistIds } } },
      {
        $group: {
          _id: '$wishlist',
          total: { $sum: 1 },
          nonDraft: { $sum: { $cond: [{ $ne: ['$status', 'draft'] }, 1, 0] } },
        },
      },
    ]);
    const countMap = new Map(countAgg.map((c) => [c._id.toString(), c]));

    // Add owner identities + safe item count to wishlists. `featured` is folded
    // to this viewer's own pin by serializeWishlist — a co-owner's pin never
    // shows up as yours.
    const viewerId = user._id.toString();
    const ownedWithOwnerEmail = ownedWishlists.map((w) => ({
      ...serializeWishlist(w, viewerId),
      ...ownerFields(w),
      itemCount: countMap.get(w._id.toString())?.total ?? 0,
    }));

    const memberWithOwnerEmail = memberOnlyWishlists.map((w) => ({
      ...serializeWishlist(w, viewerId),
      ...ownerFields(w),
      itemCount: countMap.get(w._id.toString())?.nonDraft ?? 0,
      isMember: true,
      userRole: 'member' as const,
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          owned: ownedWithOwnerEmail,
          member: memberWithOwnerEmail,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching wishlists:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch wishlists' },
      { status: 500 }
    );
  }
}

// POST /api/wishlists - Create a new wishlist
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    // Throttle content creation to stop bulk junk.
    const limited = await enforce('content', session.user.id);
    if (limited) return limited;

    await connectDB();

    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 });
    }

    // Validate request body
    const validation = await validateRequestBody(request, createWishlistSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const { name, description, visibility, bannerUrl, currency } = validation.data;

    // Create wishlist with a URL slug derived from its name.
    const slug = await generateUniqueWishlistSlug(name);
    const wishlist = await Wishlist.create({
      name,
      slug,
      description,
      // Creating a list is the first of the three ways to become an owner (the
      // others are being invited as one, or being promoted — both consented).
      owners: [user._id],
      visibility,
      isPublic: visibility === 'everyone',
      bannerUrl: bannerUrl || null,
      currency: currency || user.defaultCurrency || 'USD',
    });

    return NextResponse.json(
      { success: true, data: serializeWishlist(wishlist, user._id.toString()) },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create wishlist' },
      { status: 500 }
    );
  }
}
