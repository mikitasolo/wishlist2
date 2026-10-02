import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import { errorKind } from '@/lib/utils/errorKind';

// GET /api/users/me/reservations/count - how many reservations the current
// user holds, for the dashboard's "Reserved by you" tile. It's the length of
// the Booked page's list (`GET /api/users/me/reservations`), both its sections
// together: the gifts still reserved and the ones that need confirmation
// because they've come apart from their item. One count on the gifter's index,
// without the live items, lists and memberships that list reads.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const count = await Reservation.countDocuments({ gifter: session.user.id });

    return NextResponse.json({ success: true, data: { count } }, { status: 200 });
  } catch (error) {
    // Its kind only: an error may quote the query, which is the user's id.
    console.error('Error counting reservations:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to count reservations' },
      { status: 500 }
    );
  }
}
