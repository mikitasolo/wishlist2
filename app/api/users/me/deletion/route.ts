import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { soleOwnedWishlists } from '@/lib/utils/accountDeletion';

// GET /api/users/me/deletion - what deleting the account would delete with it,
// for its confirmation (WIS-276): the lists the caller owns alone, archived ones
// included, by name. Only ever the caller's own lists.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const lists = await soleOwnedWishlists(session.user.id);
    return NextResponse.json(
      {
        success: true,
        data: { soleOwnedLists: lists.map((l) => ({ _id: l._id.toString(), name: l.name })) },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error reading account deletion preview:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read your lists' },
      { status: 500 }
    );
  }
}
