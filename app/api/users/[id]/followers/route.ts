import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Follow from '@/models/Follow';

// GET /api/users/[id]/followers - list the people who follow this user
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await connectDB();

    const edges = await Follow.find({ following: id }).select('follower').sort({ createdAt: -1 }).lean();
    const ids = edges.map((e) => e.follower);
    const users = await User.find({ _id: { $in: ids } }).select('username image');
    // Preserve follow order (newest first)
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    const data = ids
      .map((uid) => {
        const u = byId.get(uid.toString());
        return u?.username
          ? { _id: uid.toString(), username: u.username, image: u.image ?? null }
          : null;
      })
      .filter((u): u is { _id: string; username: string; image: string | null } => !!u);

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching followers:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch followers' }, { status: 500 });
  }
}
