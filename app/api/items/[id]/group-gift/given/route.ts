import { NextRequest, NextResponse } from 'next/server';
import { organizerAction } from '@/lib/utils/groupGiftRoutes';

// POST /api/items/[id]/group-gift/given — mark the group gift (WIS-361) as
// given: a gift-history entry for each contributor with their pledge, their
// Reservations taken into them; the owner's item untouched. The organizer's
// alone (see `organizerAction`). Answers with the item as their list read
// shows it now.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await organizerAction(request, id, 'given');
  } catch (error) {
    console.error('Error marking group gift as given:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to mark group gift as given' },
      { status: 500 }
    );
  }
}
