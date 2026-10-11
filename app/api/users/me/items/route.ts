import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { itemPriceInUsdCents } from '@/lib/utils/itemPrice';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';

// GET /api/users/me/items - all items across the wishlists the user co-owns.
// Booking state is never revealed to any owner (booked folds into "available").
// Archived lists are left out, as they are from the dashboard's counts, unless
// the request asks for them with `?includeArchived=true`. `archivedItems` says
// how many items the caller's archived lists hold, so the page can offer them.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const owned = await Wishlist.find(ownedByFilter(session.user.id)).select('name slug archived');
    const wishlists = includeArchived ? owned : owned.filter((w) => w.archived !== true);
    const archivedIds = owned.filter((w) => w.archived === true).map((w) => w._id);
    const byId = new Map(wishlists.map((w) => [w._id.toString(), w]));

    const items = await Item.find({ wishlist: { $in: wishlists.map((w) => w._id) } })
      .sort({ createdAt: -1 })
      .lean();

    // Rates for a currency-normalized value so price sorting is comparable
    // across currencies (e.g. PLN vs USD).
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates || new Map<string, number>();

    const archivedItems =
      archivedIds.length > 0 ? await Item.countDocuments({ wishlist: { $in: archivedIds } }) : 0;

    const data = items.map((i) => {
      const wishlist = byId.get(i.wishlist.toString());
      return {
        _id: i._id.toString(),
        name: i.name,
        imageUrl: i.imageUrl ?? null,
        price: i.price ?? null,
        priceInUsdCents: itemPriceInUsdCents(i.price, rates),
        link: i.link ?? null,
        // Searched on the page with the name (WIS-423); the owner's own text.
        notes: i.notes ?? null,
        // lean() skips schema defaults, so an item saved before the flag has none.
        mostWanted: i.mostWanted === true,
        status: i.status === 'booked' ? 'available' : i.status,
        wishlistId: i.wishlist.toString(),
        wishlistSlug: wishlist?.slug ?? null,
        wishlistName: wishlist?.name || 'Wishlist',
        wishlistArchived: wishlist?.archived === true,
        // The date sorts read it, as they do on the wishlist page.
        createdAt: i.createdAt,
      };
    });

    return NextResponse.json({ success: true, data, archivedItems }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch items' }, { status: 500 });
  }
}
