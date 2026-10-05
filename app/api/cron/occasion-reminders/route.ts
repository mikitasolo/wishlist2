import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { cronRefusal } from '@/lib/utils/cronAuth';
import { sendOccasionReminders } from '@/lib/utils/occasionReminders';

export const maxDuration = 60;

/**
 * The daily occasion reminders (WIS-193), run by Vercel Cron (`crons` in
 * `vercel.json`; production deployment only), behind the `CRON_SECRET` bearer
 * (`cronRefusal`). Reminds each due list's members a week ahead, once per
 * occurrence, up to a cap per run (`sendOccasionReminders`). Safe to re-run:
 * a reminder already sent is never sent again. Answers counts only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = cronRefusal(request);
  if (refused) return refused;

  try {
    await connectDB();
    const result = await sendOccasionReminders();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error(
      `Occasion reminders failed (${err instanceof Error ? err.name : 'unknown error'})`
    );
    return NextResponse.json({ success: false, error: 'Reminders failed' }, { status: 500 });
  }
}
