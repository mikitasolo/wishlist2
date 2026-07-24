import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import GiftLog from '@/models/GiftLog';

// DELETE /api/gifts/[id] - remove an entry from your own gift history (a mistake
// you'd rather not keep). Only the gifter who owns the entry can delete it.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    await connectDB();

    const entry = await GiftLog.findById(id);
    if (!entry || entry.gifter.toString() !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Gift entry not found' }, { status: 404 });
    }

    await GiftLog.findByIdAndDelete(id);
    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error deleting gift entry:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete gift entry' },
      { status: 500 }
    );
  }
}
