import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { cronRefusal } from '@/lib/utils/cronAuth';
import { pingCronHeartbeat } from '@/lib/utils/cronHeartbeat';
import { runBirthdayTasks } from '@/lib/utils/birthdayCron';

export const maxDuration = 60;

/**
 * The daily birthday cron (WIS-345), run by Vercel Cron (`crons` in
 * `vercel.json`; production deployment only), behind the `CRON_SECRET`
 * bearer (`cronRefusal`). Runs every birthday task in turn, each within its
 * own time budget and caps (`runBirthdayTasks`, lib/utils/birthdayCron.ts),
 * friends' birthday reminders a week ahead (`reminders`), then the nudge
 * email three weeks before your own (`nudges`). Safe to re-run: nothing
 * already sent is sent again. Answers counts only, per task; a 500 if any
 * task failed (the others still ran).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = cronRefusal(request);
  if (refused) return refused;

  try {
    await connectDB();
    const { ok, results } = await runBirthdayTasks();
    if (ok) await pingCronHeartbeat('birthdays', results);
    return NextResponse.json({ success: ok, ...results }, { status: ok ? 200 : 500 });
  } catch (err) {
    console.error(`Birthday cron failed (${err instanceof Error ? err.name : 'unknown error'})`);
    return NextResponse.json({ success: false, error: 'Birthday cron failed' }, { status: 500 });
  }
}
