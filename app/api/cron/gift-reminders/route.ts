import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { cronRefusal } from '@/lib/utils/cronAuth';
import { sendGiftReminders } from '@/lib/utils/giftReminders';

export const maxDuration = 60;

/**
 * The daily reminders about what you've reserved (WIS-384), run by Vercel
 * Cron (`crons` in `vercel.json`; production deployment only), behind the
 * `CRON_SECRET` bearer (`cronRefusal`). A week before a list's occasion, and
 * a few days after it for what isn't marked as given yet, each holder of a
 * reservation on it is reminded, once per occurrence, up to a cap per run
 * (`sendGiftReminders`). Safe to re-run: nothing already sent is sent again.
 * Answers counts only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = cronRefusal(request);
  if (refused) return refused;

  try {
    await connectDB();
    const result = await sendGiftReminders();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error(`Gift reminders failed (${err instanceof Error ? err.name : 'unknown error'})`);
    return NextResponse.json({ success: false, error: 'Reminders failed' }, { status: 500 });
  }
}
