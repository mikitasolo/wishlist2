import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import { readReservationLiveState } from '@/lib/utils/reservationLiveState';

// GET /api/users/me/reservations - the current user's active reservations
// (gifts they're holding), across all wishlists. Each carries a frozen snapshot
// and its item's id, plus the live item's current status so the UI can hint
// when the owner has since completed / drafted / removed it, whether the gifter
// may still open the list (`listOpen`), and, only while they may, its live slug
// (for the card's link, which falls back to the id) and occasion (which the
// page groups the gifts still to give by).
//
// A reservation on a list that only its archiving hides from the gifter
// (`listArchived`) is frozen instead (WIS-124): an archived list is its owners'
// alone, so it comes back as its snapshot only, with no live item status, no
// `stillReserved` (both `null`), and no slug or occasion, until the list is
// unarchived.
//
// A card is active (Release) only while it's still reserved on a list they can
// open, since the list's own unbook refuses anyone the list is hidden from. A
// booking on a list they can't open (one made private since they left, say, or
// archived: leaving or being removed frees it) can be released by an owner
// alone, so the card needs their confirmation instead (`needsConfirmation`),
// and offers Dismiss, which leaves the item as it is anyway, out of their
// reach. The dashboard's "N reservations changed" (`./summary`) counts those
// cards, from the same live state (`readReservationLiveState`).
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

    // The live items and wishlists (either may be gone), each in a fixed number
    // of queries however many reservations there are.
    const liveState = await readReservationLiveState(session.user.id, reservations);

    const data = reservations.map((r) => {
      const { wishlist, itemStatus, stillReserved, listOpen, listArchived } = liveState(r);
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
        listOpen,
        listArchived,
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
