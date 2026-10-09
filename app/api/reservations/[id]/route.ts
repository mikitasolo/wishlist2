import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';
import { inLiveGroupGift } from '@/lib/utils/groupGifts';
import { isObjectIdParam } from '@/lib/utils/objectId';

// DELETE /api/reservations/[id] - dismiss a reservation without logging a gift
// (e.g. the owner completed it themselves and you never gave it). Removes it
// from your "Reserved by you" list; does not touch the live item. So the page
// offers it only on a reservation detached from its item: one the gifter still
// holds the item's booking of is released instead, with the list's own unbook
// (`PATCH /api/items/[id]`), which frees the item and ends this record with it.
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

    const reservation = isObjectIdParam(id) ? await Reservation.findById(id) : null;
    if (!reservation || reservation.gifter.toString() !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Reservation not found' }, { status: 404 });
    }

    // A contributor still in a live group gift leaves it instead (WIS-363):
    // dismissing would leave them in it, their share still counted, with no
    // card for it.
    if (await inLiveGroupGift(session.user.id, reservation.item)) {
      return NextResponse.json(
        { success: false, error: 'You’re still in this group gift: leave it from its list' },
        { status: 409 }
      );
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
