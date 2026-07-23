import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';

// GET /api/users/me/booked - items the current user has reserved, across wishlists
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const me = new mongoose.Types.ObjectId(session.user.id);
    // "To give" = still booked by me; "Gifted" = I gifted it (now completed and
    // unassigned, but tracked via giftedBy so it stays in my archive).
    const items = await Item.find({
      $or: [
        { bookedBy: me, status: 'booked' },
        { giftedBy: me },
      ],
    })
      .sort({ giftedAt: 1, updatedAt: -1 })
      .lean();

    // Attach the wishlist name/id for each item
    const wishlistIds = Array.from(new Set(items.map((i) => i.wishlist.toString())));
    const wishlists = await Wishlist.find({ _id: { $in: wishlistIds } }).select('name slug');
    const wishlistMap = new Map(wishlists.map((w) => [w._id.toString(), w.name]));
    const wishlistSlugMap = new Map(wishlists.map((w) => [w._id.toString(), w.slug ?? null]));

    const data = items.map((i) => ({
      _id: i._id.toString(),
      name: i.name,
      imageUrl: i.imageUrl ?? null,
      price: i.price ?? null,
      link: i.link ?? null,
      giftedAt: i.giftedAt ?? null,
      wishlistId: i.wishlist.toString(),
      wishlistSlug: wishlistSlugMap.get(i.wishlist.toString()) ?? null,
      wishlistName: wishlistMap.get(i.wishlist.toString()) || 'Wishlist',
    }));

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching booked items:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch booked items' }, { status: 500 });
  }
}
