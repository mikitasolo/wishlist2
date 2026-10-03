import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import { errorKind } from '@/lib/utils/errorKind';
import { readReservationLiveState } from '@/lib/utils/reservationLiveState';
import { needsConfirmation } from '@/lib/utils/reservations';

// GET /api/users/me/reservations/summary - for the dashboard's "Needs you":
// `changed`, how many of the current user's own reservations need their
// confirmation, because they've come apart from their item (the owner received,
// drafted or removed it, someone else holds it) or from their list (no longer
// open to them, or archived). It's the Booked page's "Needs your confirmation"
// section (`GET /api/users/me/reservations`), counted: both read the same live
// state (`readReservationLiveState`) and judge it with `needsConfirmation`, so
// the two never disagree.
//
// Only ever the caller's own reservations, counted for the caller alone: a
// count of reservations never reaches anyone but the gifter who holds them, and
// an owner holds none on their own lists. Nothing of the lists or items behind
// them comes back, only the one number.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const reservations = await Reservation.find({ gifter: session.user.id })
      .select('item wishlist')
      .lean();
    const liveState = await readReservationLiveState(session.user.id, reservations);
    const changed = reservations.filter((r) => needsConfirmation(liveState(r))).length;

    return NextResponse.json({ success: true, data: { changed } }, { status: 200 });
  } catch (error) {
    // Its kind only: an error may quote the query, which is the user's id.
    console.error('Error summarizing reservations:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to summarize reservations' },
      { status: 500 }
    );
  }
}
