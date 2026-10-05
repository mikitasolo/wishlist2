import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { enforce, ipKey } from '@/lib/rateLimit';
import { errorKind } from '@/lib/utils/errorKind';
import { notificationPrefPath } from '@/lib/utils/notificationPrefs';
import { verifyUnsubscribe } from '@/lib/utils/unsubscribe';

/**
 * One-click unsubscribe from one notification email (WIS-321): turns off
 * `notificationPrefs.<event>.email` for the account the signed link names
 * (`verifyUnsubscribe`), and nothing else. It's the `List-Unsubscribe` header's
 * target, which a mail client POSTs to with `List-Unsubscribe=One-Click` (RFC
 * 8058), and what the `/unsubscribe` page's button sends.
 *
 * - **POST only.** A GET does nothing (Next answers 405), so a mail scanner or
 *   link preview that opens every URL in a message never unsubscribes anyone.
 * - **Signed out.** The signature is the authorization; no session is read, so
 *   a link works from any device, whoever is signed in there.
 * - **Says nothing about the account.** A valid link is answered the same
 *   whether or not its account still exists, and nothing in the answer comes
 *   from the account (no email, no name).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await enforce('unsubscribe', ipKey(request.headers));
  if (limited) return limited;

  const { searchParams } = request.nextUrl;
  const target = verifyUnsubscribe({
    u: searchParams.get('u'),
    e: searchParams.get('e'),
    t: searchParams.get('t'),
  });
  if (!target) {
    return NextResponse.json(
      { success: false, error: 'This unsubscribe link doesn’t work.' },
      { status: 400 }
    );
  }

  try {
    await connectDB();
    await User.updateOne(
      { _id: target.userId },
      { $set: { [notificationPrefPath(target.event, 'email')]: false } }
    );
  } catch (err) {
    console.error('Unsubscribe failed:', errorKind(err));
    return NextResponse.json(
      { success: false, error: 'Couldn’t unsubscribe. Try again.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, event: target.event });
}
