import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';

// DELETE /api/reservations/[id] - dismiss a reservation without logging a gift
// (e.g. the owner completed it themselves and you never gave it). Removes it
// from your "Reserved by you" list; does not touch the live item.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    await connectDB();

    const reservation = await Reservation.findById(id);
    if (!reservation || reservation.gifter.toString() !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Reservation not found' }, { status: 404 });
    }

    await deleteReservations({ _id: reservation._id });
    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error dismissing reservation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to dismiss reservation' },
      { status: 500 }
    );
  }
}
