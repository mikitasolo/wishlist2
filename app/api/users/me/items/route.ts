import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { itemPriceInUsdCents } from '@/lib/utils/itemPrice';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';

// GET /api/users/me/items - all items across the wishlists the user co-owns.
// Booking state is never revealed to any owner (booked folds into "available").
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const wishlists = await Wishlist.find(ownedByFilter(session.user.id)).select('name slug');
    const nameMap = new Map(wishlists.map((w) => [w._id.toString(), w.name]));
    const slugMap = new Map(wishlists.map((w) => [w._id.toString(), w.slug ?? null]));

    const items = await Item.find({ wishlist: { $in: wishlists.map((w) => w._id) } })
      .sort({ createdAt: -1 })
      .lean();

    // Rates for a currency-normalized value so price sorting is comparable
    // across currencies (e.g. PLN vs USD).
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates || new Map<string, number>();

    const data = items.map((i) => ({
      _id: i._id.toString(),
      name: i.name,
      imageUrl: i.imageUrl ?? null,
      price: i.price ?? null,
      priceInUsdCents: itemPriceInUsdCents(i.price, rates),
      link: i.link ?? null,
      // lean() skips schema defaults, so an item saved before the flag has none.
      mostWanted: i.mostWanted === true,
      status: i.status === 'booked' ? 'available' : i.status,
      wishlistId: i.wishlist.toString(),
      wishlistSlug: slugMap.get(i.wishlist.toString()) ?? null,
      wishlistName: nameMap.get(i.wishlist.toString()) || 'Wishlist',
      // The date sorts read it, as they do on the wishlist page.
      createdAt: i.createdAt,
    }));

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch items' }, { status: 500 });
  }
}
