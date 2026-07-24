import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistInvite from '@/models/WishlistInvite';
import User from '@/models/User';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isAdminOrOwner } from '@/lib/utils/wishlistAccess';

// GET /api/wishlists/[id]/invites - pending invites for a wishlist (owner/admin).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();
    if (!(await isAdminOrOwner(id, session.user.id))) {
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
