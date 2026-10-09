import { NextRequest, NextResponse } from 'next/server';
import { organizerAction } from '@/lib/utils/groupGiftRoutes';

// POST /api/items/[id]/group-gift/convert — turn the group gift (WIS-361) into
// the organizer's own booking: they keep the item and their Reservation;
// everyone else's Reservation goes. The organizer's alone (see
// `organizerAction`). Answers with the item as their list read shows it now.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await organizerAction(request, id, 'converted');
  } catch (error) {
    console.error('Error converting group gift:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to convert group gift' },
      { status: 500 }
    );
  }
}
