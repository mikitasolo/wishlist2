import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { enforce, ipKey } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import { primaryOwnerId } from '@/lib/utils/wishlistOwners';

// GET /api/search?q=... - unified search over usernames + public wishlist names
export async function GET(request: NextRequest) {
  try {
    // Public endpoint — key on IP to blunt graph scraping.
    const limited = await enforce('search', ipKey(request.headers));
    if (limited) return limited;

    const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 1) {
      return NextResponse.json({ success: true, data: { users: [], wishlists: [] } });
    }

    await connectDB();

    // Escape regex special chars, match as a substring (case-insensitive)
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');

    const [users, wishlists] = await Promise.all([
      User.find({ username: rx, 'privacy.searchable': { $ne: false } })
        .select('username image')
        .limit(6),
      Wishlist.find({
        name: rx,
        archived: { $ne: true },
        $or: [{ visibility: 'everyone' }, { visibility: { $exists: false }, isPublic: true }],
      })
        .select('name slug owners')
        .limit(6),
    ]);

    // Resolve the primary owner's username for the matched wishlists — the
    // result row has space for one name, and co-owners are listed on the list itself.
    const primaryIds = wishlists.map((w) => primaryOwnerId(w)).filter((id): id is string => !!id);
    const owners = await User.find({ _id: { $in: Array.from(new Set(primaryIds)) } }).select(
      'username'
    );
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.username]));

    return NextResponse.json({
      success: true,
      data: {
        users: users.map((u) => ({ username: u.username, image: u.image ?? null })),
        wishlists: wishlists.map((w) => ({
          _id: w._id,
          name: w.name,
          slug: w.slug ?? null,
          ownerUsername: ownerMap.get(primaryOwnerId(w) ?? '') || null,
        })),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
