import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { removeGroupMember } from '@/lib/utils/peopleGroups';

// DELETE /api/users/me/groups/[groupId]/members/[userId] - take someone out of
// one of the caller's groups. Changes no list membership or invite.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const limited = await enforce('groups', userKey(session.user.id));
    if (limited) return limited;
    const { groupId, userId } = await params;
    await connectDB();
    if (!(await removeGroupMember(session.user.id, groupId, userId))) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error removing from group:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to remove from group' },
      { status: 500 }
    );
  }
}
