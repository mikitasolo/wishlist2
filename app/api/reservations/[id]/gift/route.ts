import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import User from '@/models/User';
import { isObjectIdParam } from '@/lib/utils/objectId';
import {
  giftWishlistSlugs,
  serializeGiftLog,
  type GiftWishlistSlugs,
} from '@/lib/utils/giftHistory';

// POST /api/reservations/[id]/gift - mark a reservation as gifted. Writes a
// permanent GiftLog entry from the reservation's snapshot and removes the
// reservation. Deliberately does NOT touch the live item — completing it on the
// owner's list is the owner's decision, not the gifter's.
//
// Answers 201 with the new entry, shaped as `GET /api/users/me/gifts` lists it,
// so the Booked page can add it to its gift history without re-reading the
// whole list (a re-read could land after a delete settling meanwhile and put
// the deleted entry back).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    await connectDB();

    // Take the reservation in one atomic step, so that of a double submit, or of
    // this and a dismiss or release (which free its snapshot image), exactly one
    // gets it. The entry is then written from what was taken, image included.
    const reservation = isObjectIdParam(id)
      ? await Reservation.findOneAndDelete({ _id: id, gifter: session.user.id }).lean()
      : null;
    if (!reservation) {
      return NextResponse.json({ success: false, error: 'Reservation not found' }, { status: 404 });
    }

    let entry;
    let slugs: GiftWishlistSlugs;
    try {
      // Snapshot the recipient's username at gift time (best-effort).
      const recipient = await User.findById(reservation.owner).select('username');
      // The answer's wishlist slug is read here too, where a failure still puts
      // the reservation back. Once the entry is written, nothing may fail: that
      // would answer 500 for a gift that was logged.
      slugs = await giftWishlistSlugs([reservation]);

      entry = await GiftLog.create({
        gifter: session.user.id,
        giftedAt: new Date(),
        itemName: reservation.itemName,
        itemImage: reservation.itemImage ?? null,
        itemPrice: reservation.itemPrice ?? null,
        recipient: reservation.owner,
        recipientUsername: recipient?.username ?? null,
        wishlistName: reservation.wishlistName,
        wishlist: reservation.wishlist,
        item: reservation.item,
      });
    } catch (error) {
      // Put the reservation back exactly as it was, so the gift can be retried.
      await Reservation.collection
        .insertOne(reservation)
        .catch((err) => console.error('Could not restore the reservation of a failed gift:', err));
      throw error;
    }

    return NextResponse.json(
      { success: true, data: serializeGiftLog(entry.toObject(), slugs) },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error logging gift:', error);
    return NextResponse.json({ success: false, error: 'Failed to log gift' }, { status: 500 });
  }
}
