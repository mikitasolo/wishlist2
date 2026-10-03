import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import Item from '@/models/Item';
import { readReservationWishlists } from '@/lib/utils/reservationWishlists';

// GET /api/users/me/reservations - the current user's active reservations
// (gifts they're holding), across all wishlists. Each carries a frozen snapshot
// and its item's id, plus the live item's current status so the UI can hint
// when the owner has since completed / drafted / removed it, and, only while
// the gifter may still open the list, its live slug (for the card's link, which
// falls back to the id) and occasion (which the page groups the gifts still to
// give by).
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const reservations = await Reservation.find({ gifter: session.user.id })
      .sort({ createdAt: -1 })
      .lean();

    // Look up the live items and wishlists (either may be gone), each in a
    // fixed number of queries however many reservations there are.
    const itemIds = reservations.map((r) => r.item);
    const [items, wishlists] = await Promise.all([
      Item.find({ _id: { $in: itemIds } })
        .select('status bookedBy')
        .lean(),
      readReservationWishlists(
        session.user.id,
        reservations.map((r) => r.wishlist)
      ),
    ]);
    const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

    const data = reservations.map((r) => {
      const it = itemMap.get(r.item.toString());
      const itemStatus = it ? it.status : 'deleted';
      const wishlist = wishlists.get(r.wishlist.toString());
      // Active: the item is still booked by the gifter, on a list they can still
      // open. The card offers Release then, which unbooks the item through the
      // list's own route (`PATCH /api/items/[itemId]`), and that route refuses
      // anyone the list is hidden from. A booking on a list they can no longer
      // open (one that's been archived: leaving or being removed frees it) can't
      // be released by anyone but an owner, so it needs their confirmation
      // instead, as any other reservation detached from its item. Dismiss there
      // ends the Reservation and leaves the item as it is anyway, hidden from
      // everyone but the owners. Should the list be unarchived, the item is back
      // on it as theirs, with Unbook, and a card they kept is active again.
      const stillReserved =
        !!it && it.status === 'booked' && it.bookedBy?.toString() === session.user.id && !!wishlist;
      return {
        _id: r._id.toString(),
        // The gifter's own record of which item they reserved: what Release sends
        // its unbook to.
        itemId: r.item.toString(),
        itemName: r.itemName,
        itemImage: r.itemImage ?? null,
        itemPrice: r.itemPrice ?? null,
        wishlistName: r.wishlistName,
        wishlistId: r.wishlist.toString(),
        wishlistSlug: wishlist?.slug ?? null,
        wishlistOccasion: wishlist?.occasion ?? null,
        itemStatus,
        stillReserved,
      };
    });

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error fetching reservations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reservations' },
      { status: 500 }
    );
  }
}
