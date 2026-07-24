import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { enforce, clientIp } from '@/lib/rateLimit';
import User from '@/models/User';

// GET /api/users/search?username=... - Find a user by username (exact match).
// Respects the target user's "searchable" privacy setting.
export async function GET(request: NextRequest) {
  try {
    // Public endpoint — key on IP to blunt scraping/enumeration.
    const limited = await enforce('search', `ip:${clientIp(request.headers)}`);
    if (limited) return limited;

    const searchParams = request.nextUrl.searchParams;
    const username = (searchParams.get('username') || searchParams.get('email') || '')
      .toLowerCase()
      .trim();

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'Username parameter is required' },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findOne({ username }).select('_id username privacy');

    // Treat non-searchable profiles as not found so their existence isn't leaked.
    if (!user || user.privacy?.searchable === false) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, data: { _id: user._id, username: user.username } },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error searching for user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search for user' },
      { status: 500 }
    );
  }
}
