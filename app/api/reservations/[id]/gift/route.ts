import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import User from '@/models/User';

// POST /api/reservations/[id]/gift - mark a reservation as gifted. Writes a
// permanent GiftLog entry from the reservation's snapshot and removes the
// reservation. Deliberately does NOT touch the live item — completing it on the
// owner's list is the owner's decision, not the gifter's.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    await connectDB();

    const reservation = await Reservation.findById(id);
    if (!reservation || reservation.gifter.toString() !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Reservation not found' }, { status: 404 });
    }

    // Snapshot the recipient's username at gift time (best-effort).
    const recipient = await User.findById(reservation.owner).select('username');

    const entry = await GiftLog.create({
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

    await Reservation.findByIdAndDelete(id);

    return NextResponse.json(
      { success: true, data: { _id: entry._id.toString() } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error logging gift:', error);
    return NextResponse.json({ success: false, error: 'Failed to log gift' }, { status: 500 });
  }
}
