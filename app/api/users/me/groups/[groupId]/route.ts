import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { groupNameSchema, validateRequestBody } from '@/lib/validations';
import { deleteGroup, DUPLICATE_GROUP_NAME, renameGroup } from '@/lib/utils/peopleGroups';

type Params = { params: Promise<{ groupId: string }> };

// Someone else's group answers exactly as one that doesn't exist.
const NOT_FOUND = { success: false, error: 'Group not found' };

// PATCH /api/users/me/groups/[groupId] - rename one of the caller's groups: `{ name }`.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const limited = await enforce('groups', userKey(session.user.id));
    if (limited) return limited;
    const body = await validateRequestBody(request, groupNameSchema);
    if (!body.success) {
      return NextResponse.json({ success: false, error: body.error }, { status: body.status });
    }
    const { groupId } = await params;
    await connectDB();
    const result = await renameGroup(session.user.id, groupId, body.data.name);
    if (result === 'not-found') return NextResponse.json(NOT_FOUND, { status: 404 });
    if (result === 'duplicate') {
      return NextResponse.json({ success: false, error: DUPLICATE_GROUP_NAME }, { status: 409 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error renaming group:', error);
    return NextResponse.json({ success: false, error: 'Failed to rename group' }, { status: 500 });
  }
}

// DELETE /api/users/me/groups/[groupId] - delete one of the caller's groups.
// Only the tag goes: no list membership or invite changes.
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const limited = await enforce('groups', userKey(session.user.id));
    if (limited) return limited;
    const { groupId } = await params;
    await connectDB();
    if (!(await deleteGroup(session.user.id, groupId))) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting group:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete group' }, { status: 500 });
  }
}
