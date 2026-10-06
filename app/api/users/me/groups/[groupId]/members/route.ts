import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { groupMemberSchema, validateRequestBody } from '@/lib/validations';
import { addGroupMember, GROUP_MEMBER_LIMIT } from '@/lib/utils/peopleGroups';

// POST /api/users/me/groups/[groupId]/members - tag someone the caller follows
// into one of their groups: `{ userId }`. Nobody is told: no notification, and
// nothing the tagged person can read changes.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const limited = await enforce('groups', userKey(session.user.id));
    if (limited) return limited;
    const body = await validateRequestBody(request, groupMemberSchema);
    if (!body.success) {
      return NextResponse.json({ success: false, error: body.error }, { status: body.status });
    }
    const { groupId } = await params;
    await connectDB();
    const result = await addGroupMember(session.user.id, groupId, body.data.userId);
    if (result === 'not-found') {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
    }
    if (result === 'not-following') {
      return NextResponse.json(
        { success: false, error: 'You can only add people you follow.' },
        { status: 400 }
      );
    }
    if (result === 'full') {
      return NextResponse.json(
        { success: false, error: `A group can have up to ${GROUP_MEMBER_LIMIT} people.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error adding to group:', error);
    return NextResponse.json({ success: false, error: 'Failed to add to group' }, { status: 500 });
  }
}
