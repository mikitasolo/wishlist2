import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import { generateUniqueWishlistSlug } from '@/lib/utils/wishlistSlug';
import mongoose from 'mongoose';
import { createWishlistSchema, validateRequestBody } from '@/lib/validations';

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

    // Get all wishlists owned by user, sorted by creation date
    const ownedWishlists = await Wishlist.find({ owner: user._id }).sort({ createdAt: -1 });

    // Get all wishlists where user is a member (not owner)
    const memberships = await WishlistMember.find({ user: user._id });
    const roleMap = new Map(memberships.map((m) => [m.wishlist.toString(), m.role]));
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

    // Get owner emails for all wishlists
    const allWishlistOwners = new Set([
      ...ownedWishlists.map((w) => w.owner.toString()),
      ...memberOnlyWishlists.map((w) => w.owner.toString()),
    ]);
    const owners = await User.find({ _id: { $in: Array.from(allWishlistOwners) } }).select(
      'username image'
    );
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o]));

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

    // Add owner email + safe item count to wishlists
    const ownedWithOwnerEmail = ownedWishlists.map((w) => ({
      ...w.toObject(),
      ownerUsername: ownerMap.get(w.owner.toString())?.username || null,
      ownerImage: ownerMap.get(w.owner.toString())?.image ?? null,
      itemCount: countMap.get(w._id.toString())?.total ?? 0,
    }));

    const memberWithOwnerEmail = memberOnlyWishlists.map((w) => ({
      ...w.toObject(),
      ownerUsername: ownerMap.get(w.owner.toString())?.username || null,
      ownerImage: ownerMap.get(w.owner.toString())?.image ?? null,
      itemCount: countMap.get(w._id.toString())?.nonDraft ?? 0,
      isMember: true,
      userRole: roleMap.get(w._id.toString()) ?? 'member',
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
      owner: user._id,
      visibility,
      isPublic: visibility === 'everyone',
      bannerUrl: bannerUrl || null,
      currency: currency || user.defaultCurrency || 'USD',
    });

    return NextResponse.json({ success: true, data: wishlist }, { status: 201 });
  } catch (error) {
    console.error('Error creating wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create wishlist' },
      { status: 500 }
    );
  }
}
