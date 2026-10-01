import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import User from '@/models/User';
import { isObjectIdParam } from '@/lib/utils/objectId';

// POST /api/reservations/[id]/gift - mark a reservation as gifted. Writes a
// permanent GiftLog entry from the reservation's snapshot and removes the
// reservation. Deliberately does NOT touch the live item — completing it on the
// owner's list is the owner's decision, not the gifter's.
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
    try {
      // Snapshot the recipient's username at gift time (best-effort).
      const recipient = await User.findById(reservation.owner).select('username');

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
      { success: true, data: { _id: entry._id.toString() } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error logging gift:', error);
    return NextResponse.json({ success: false, error: 'Failed to log gift' }, { status: 500 });
  }
}
