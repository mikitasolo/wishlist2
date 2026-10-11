import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { cronRefusal } from '@/lib/utils/cronAuth';
import { pingCronHeartbeat } from '@/lib/utils/cronHeartbeat';
import { sendGiftReminders } from '@/lib/utils/giftReminders';
import { settleAllDeadMoves, type DeadMoveSweep } from '@/lib/utils/bulkItemActions';
import { errorKind } from '@/lib/utils/errorKind';

export const maxDuration = 60;

/**
 * The daily reminders about what you've reserved (WIS-384), run by Vercel
 * Cron (`crons` in `vercel.json`; production deployment only), behind the
 * `CRON_SECRET` bearer (`cronRefusal`). A week before a list's occasion, and
 * a few days after it for what isn't marked as given yet, each holder of a
 * reservation on it is reminded, once per occurrence, up to a cap per run
 * (`sendGiftReminders`). Safe to re-run: nothing already sent is sent again.
 *
 * It first settles everyone's dead item moves (WIS-443, `settleAllDeadMoves`:
 * capped, on its own time budget), here rather than in a cron of its own
 * (Hobby allows few); a failure there is logged and the reminders still go.
 * Answers counts only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = cronRefusal(request);
  if (refused) return refused;

  try {
    await connectDB();
    let deadMoves: DeadMoveSweep | { error: true };
    try {
      deadMoves = await settleAllDeadMoves();
    } catch (err) {
      console.error('Settling dead item moves failed:', errorKind(err));
      deadMoves = { error: true };
    }
    const result = await sendGiftReminders();
    // Only a whole run pings: a dead-move settling that failed is a failure
    // too, so a check that stops hearing from this cron catches it.
    if (!('error' in deadMoves))
      await pingCronHeartbeat('gift-reminders', { ...result, deadMoves });
    return NextResponse.json({ success: true, ...result, deadMoves });
  } catch (err) {
    console.error(`Gift reminders failed (${err instanceof Error ? err.name : 'unknown error'})`);
    return NextResponse.json({ success: false, error: 'Reminders failed' }, { status: 500 });
  }
}
