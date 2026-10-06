import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { groupNameSchema, validateRequestBody } from '@/lib/validations';
import {
  createGroup,
  DUPLICATE_GROUP_NAME,
  GROUP_LIMIT,
  listGroups,
} from '@/lib/utils/peopleGroups';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// GET /api/users/me/groups - the caller's own groups (WIS-27), each with the
// people in it, named with `publicDisplayName` (never an email). Groups are
// private: there is no route that reads anyone else's.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: PRIVATE }
      );
    }
    await connectDB();
    const data = await listGroups(session.user.id);
    return NextResponse.json({ success: true, data }, { status: 200, headers: PRIVATE });
  } catch (error) {
    console.error('Error fetching groups:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch groups' },
      { status: 500, headers: PRIVATE }
    );
  }
}

// POST /api/users/me/groups - make a group: `{ name }`.
export async function POST(request: NextRequest) {
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
    await connectDB();
    const result = await createGroup(session.user.id, body.data.name);
    if (result.status === 'limit') {
      return NextResponse.json(
        { success: false, error: `You can have up to ${GROUP_LIMIT} groups.` },
        { status: 409 }
      );
    }
    if (result.status === 'duplicate') {
      return NextResponse.json({ success: false, error: DUPLICATE_GROUP_NAME }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: result.group }, { status: 201 });
  } catch (error) {
    console.error('Error creating group:', error);
    return NextResponse.json({ success: false, error: 'Failed to create group' }, { status: 500 });
  }
}
