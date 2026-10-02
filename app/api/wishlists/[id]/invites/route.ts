import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistInvite from '@/models/WishlistInvite';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';

// GET /api/wishlists/[id]/invites - pending invites for a wishlist (owners).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    // Before the list is looked up, so a signed-out caller is told the same
    // whether or not it exists (an archived list's existence is its owners').
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    await connectDB();
    // An archived list comes back as no list at all to anyone but its owners
    // (see `getOwnerAccess`).
    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const invites = await WishlistInvite.find({ wishlist: id, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const userIds = invites.map((i) => i.invitedUser);
    const users = await User.find({ _id: { $in: userIds } }).select('username image');
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    const data = invites.map((i) => {
      const u = byId.get(i.invitedUser.toString());
      return {
        _id: i._id.toString(),
        role: i.role,
        username: u?.username ?? null,
        image: u?.image ?? null,
        createdAt: i.createdAt,
      };
    });

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error listing invites:', error);
    return NextResponse.json({ success: false, error: 'Failed to list invites' }, { status: 500 });
  }
}
