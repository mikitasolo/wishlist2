import { NextRequest, NextResponse } from 'next/server';
import { organizerAction } from '@/lib/utils/groupGiftRoutes';

// POST /api/items/[id]/group-gift/cancel — cancel the group gift (WIS-361): the
// item is released and every contributor's Reservation of it goes. The
// organizer's alone (see `organizerAction`). Answers with the item as the
// organizer's list read shows it now.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await organizerAction(request, id, 'cancelled');
  } catch (error) {
    console.error('Error cancelling group gift:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel group gift' },
      { status: 500 }
    );
  }
}
