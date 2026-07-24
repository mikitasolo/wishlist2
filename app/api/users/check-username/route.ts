import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { USERNAME_REGEX } from '@/lib/validations';
import { isReservedUsername } from '@/lib/utils/username';

// GET /api/users/check-username?username=... - live availability check
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const raw = (request.nextUrl.searchParams.get('username') || '').toLowerCase().trim();

  if (!USERNAME_REGEX.test(raw)) {
    return NextResponse.json(
      { success: true, available: false, reason: 'invalid' },
      { status: 200 }
    );
  }
  if (isReservedUsername(raw)) {
    return NextResponse.json(
      { success: true, available: false, reason: 'reserved' },
      { status: 200 }
    );
  }

  await connectDB();
  const taken = await User.exists({ username: raw, _id: { $ne: session.user.id } });
  return NextResponse.json(
    { success: true, available: !taken, reason: taken ? 'taken' : 'ok' },
    { status: 200 }
  );
}
