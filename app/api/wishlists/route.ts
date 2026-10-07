import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { generateUniqueWishlistSlug } from '@/lib/utils/wishlistSlug';
import { createWishlistSchema, validateRequestBody } from '@/lib/validations';
import { ownedByFilter, ownerIds, serializeWishlist } from '@/lib/utils/wishlistOwners';
import { canAttachImage, FOREIGN_IMAGE_ERROR } from '@/lib/utils/blob';
import { countReservedBy, countWishlistItems, countsFor } from '@/lib/utils/wishlistItemCounts';
import { notifyAskersOfNewList } from '@/lib/utils/wishlistAsks';

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

    // Each list's item count, by the rule every screen counts with
    // (`lib/utils/itemCounts.ts`): `itemCount` is its published items, booked
    // folded in, so no owner learns what has been reserved. Your own lists add
    // their drafts and proposals to review; a list you're a member of carries
    // neither, so a member never learns of hidden drafts or of anyone's proposal.
    //
    // And on each list you're a member of, how many of its items you've
    // reserved yourself ("2 reserved by you"). Counted only on those lists and
    // only your own bookings: your own lists never carry the field, not even as
    // 0, since an owner never learns what has been reserved, and nobody learns
    // what anyone else has.
    const [counts, reservedByYou] = await Promise.all([
      countWishlistItems([
        ...ownedWishlists.map((w) => w._id),
        ...memberOnlyWishlists.map((w) => w._id),
      ]),
      countReservedBy(
        memberOnlyWishlists.map((w) => w._id),
        user._id
      ),
    ]);

    // Add owner identities + safe item count to wishlists. `featured` is folded
    // to this viewer's own pin by serializeWishlist — a co-owner's pin never
    // shows up as yours.
    const viewerId = user._id.toString();
    const ownedWithOwnerEmail = ownedWishlists.map((w) => {
      const { items, drafts, proposals } = countsFor(counts, w._id);
      return {
        ...serializeWishlist(w, viewerId),
        ...ownerFields(w),
        itemCount: items,
        draftCount: drafts,
        proposalCount: proposals,
      };
    });

    const memberWithOwnerEmail = memberOnlyWishlists.map((w) => ({
      ...serializeWishlist(w, viewerId),
      ...ownerFields(w),
      itemCount: countsFor(counts, w._id).items,
      reservedByYou: reservedByYou.get(w._id.toString()) ?? 0,
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
    const limited = await enforce('content', userKey(session.user.id), {
      newAccount: session.user.newAccount,
    });
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

    const { name, description, visibility, bannerUrl, currency, occasion } = validation.data;

    if (!canAttachImage(bannerUrl, session.user.id)) {
      return NextResponse.json({ success: false, error: FOREIGN_IMAGE_ERROR }, { status: 400 });
    }

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
      bannerUrl: bannerUrl || null,
      ...(occasion ? { occasion } : {}),
      currency: currency || user.defaultCurrency || 'USD',
    });

    // WIS-324: friends who asked for a list, and can open this one, are told.
    await notifyAskersOfNewList(wishlist, user._id, user.username);

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
