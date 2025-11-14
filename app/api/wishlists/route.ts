import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { createWishlistSchema, validateRequestBody } from '@/lib/validations';

// GET /api/wishlists - Get all wishlists user has access to
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    await connectDB();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 403 }
      );
    }

    // Get all wishlists owned by user, sorted by creation date
    const ownedWishlists = await Wishlist.find({ owner: user._id }).sort({ createdAt: -1 });

    // Get all wishlists where user is a member (not owner)
    const memberships = await WishlistMember.find({ user: user._id });
    const wishlistIds = memberships.map(m => m.wishlist);
    const memberWishlists = await Wishlist.find({ _id: { $in: wishlistIds } }).sort({ createdAt: -1 });
    
    // Filter out owned wishlists from member wishlists (in case user is both owner and member)
    const ownedWishlistIds = new Set(ownedWishlists.map(w => w._id.toString()));
    const memberOnlyWishlists = memberWishlists.filter(w => !ownedWishlistIds.has(w._id.toString()));

    // Get owner emails for all wishlists
    const allWishlistOwners = new Set([
      ...ownedWishlists.map(w => w.owner.toString()),
      ...memberOnlyWishlists.map(w => w.owner.toString()),
    ]);
    const owners = await User.find({ _id: { $in: Array.from(allWishlistOwners) } }).select('email');
    const ownerMap = new Map(owners.map(o => [o._id.toString(), o.email]));

    // Add owner email to wishlists
    const ownedWithOwnerEmail = ownedWishlists.map(w => ({
      ...w.toObject(),
      ownerEmail: ownerMap.get(w.owner.toString()) || null,
    }));

    const memberWithOwnerEmail = memberOnlyWishlists.map(w => ({
      ...w.toObject(),
      ownerEmail: ownerMap.get(w.owner.toString()) || null,
    }));

    return NextResponse.json({ 
      success: true, 
      data: {
        owned: ownedWithOwnerEmail,
        member: memberWithOwnerEmail,
      }
    }, { status: 200 });
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
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();
    
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, createWishlistSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const { name, description, isPublic } = validation.data;

    // Create wishlist
    const wishlist = await Wishlist.create({
      name,
      description,
      owner: user._id,
      isPublic,
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

