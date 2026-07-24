import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import GiftLog from '@/models/GiftLog';
import Wishlist from '@/models/Wishlist';

// GET /api/users/me/gifts - the current user's gift history (permanent log of
// gifts they've marked as given), newest first.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const gifts = await GiftLog.find({ gifter: session.user.id }).sort({ giftedAt: -1 }).lean();

    // Resolve current wishlist slugs for still-valid soft pointers (for links).
    const wishlistIds = Array.from(
      new Set(gifts.map((g) => g.wishlist?.toString()).filter(Boolean) as string[])
    );
    const wishlists = wishlistIds.length
      ? await Wishlist.find({ _id: { $in: wishlistIds } }).select('slug')
      : [];
    const slugMap = new Map(wishlists.map((w) => [w._id.toString(), w.slug ?? null]));

    const data = gifts.map((g) => ({
      _id: g._id.toString(),
      itemName: g.itemName,
      itemImage: g.itemImage ?? null,
      itemPrice: g.itemPrice ?? null,
      recipientUsername: g.recipientUsername ?? null,
      wishlistName: g.wishlistName ?? null,
      wishlistId: g.wishlist?.toString() ?? null,
      wishlistSlug: g.wishlist ? (slugMap.get(g.wishlist.toString()) ?? null) : null,
      giftedAt: g.giftedAt,
    }));

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching gift history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch gift history' },
      { status: 500 }
    );
  }
}
