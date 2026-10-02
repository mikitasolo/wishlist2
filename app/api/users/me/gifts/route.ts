import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import GiftLog from '@/models/GiftLog';
import { giftWishlistSlugs, serializeGiftLog } from '@/lib/utils/giftHistory';

// GET /api/users/me/gifts - the current user's gift history (permanent log of
// gifts they've marked as given), newest first.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const gifts = await GiftLog.find({ gifter: session.user.id }).sort({ giftedAt: -1 }).lean();

    // The current slugs of the lists the gifter may still open (for links).
    const slugs = await giftWishlistSlugs(session.user.id, gifts);
    const data = gifts.map((g) => serializeGiftLog(g, slugs));

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching gift history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch gift history' },
      { status: 500 }
    );
  }
}
