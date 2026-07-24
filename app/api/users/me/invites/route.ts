import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import User from '@/models/User';

// GET /api/users/me/invites - pending wishlist invites addressed to the current
// user's account.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const invites = await WishlistInvite.find({
      status: 'pending',
      invitedUser: session.user.id,
    })
      .sort({ createdAt: -1 })
      .lean();

    const wishlists = await Wishlist.find({
      _id: { $in: invites.map((i) => i.wishlist) },
    }).select('name slug');
    const wlMap = new Map(wishlists.map((w) => [w._id.toString(), w]));

    const inviters = await User.find({
      _id: { $in: invites.map((i) => i.invitedBy) },
    }).select('username image');
    const invMap = new Map(inviters.map((u) => [u._id.toString(), u]));

    const data = invites
      .map((i) => {
        const w = wlMap.get(i.wishlist.toString());
        if (!w) return null; // wishlist was deleted
        const inviter = invMap.get(i.invitedBy.toString());
        return {
          _id: i._id.toString(),
          role: i.role,
          wishlistId: i.wishlist.toString(),
          wishlistName: w.name,
          wishlistSlug: w.slug ?? null,
          invitedByUsername: inviter?.username ?? null,
          invitedByImage: inviter?.image ?? null,
          createdAt: i.createdAt,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error listing my invites:', error);
    return NextResponse.json({ success: false, error: 'Failed to load invites' }, { status: 500 });
  }
}
