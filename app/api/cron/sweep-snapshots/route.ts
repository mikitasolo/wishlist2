import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { secretsMatch } from '@/lib/utils/migration';
import { sweepOrphanSnapshots } from '@/lib/utils/orphanSnapshots';

/** Room for a full listing, the re-check delay and the deletes. */
export const maxDuration = 60;

/**
 * The monthly sweep of orphaned snapshot blobs (WIS-331), run by Vercel Cron
 * (`crons` in `vercel.json`; crons run on the production deployment only).
 * Vercel calls it with `GET` and `Authorization: Bearer $CRON_SECRET`, so it is
 * refused unless `CRON_SECRET` is set and matches. Deletes only snapshots no
 * reservation or gift log holds, checked twice (`sweepOrphanSnapshots`). The
 * read-only report is `POST /api/maintenance/orphan-snapshots`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET is not set' }, { status: 500 });
  }
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!secretsMatch(token, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectDB();
    const result = await sweepOrphanSnapshots();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error(
      `Snapshot sweep failed (${err instanceof Error ? err.name : 'unknown error'}); nothing was deleted`
    );
    return NextResponse.json({ success: false, error: 'Sweep failed' }, { status: 500 });
  }
}
