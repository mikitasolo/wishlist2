import { NextResponse, type NextRequest } from 'next/server';
import { secretsMatch } from '@/lib/utils/migration';

/**
 * The gate every Vercel Cron route (`app/api/cron/<name>`) opens with. Vercel
 * calls it with `GET` and `Authorization: Bearer $CRON_SECRET`, so it's refused
 * unless `CRON_SECRET` is set and matches: the 500 or 401 to answer with, or
 * `null` to go on.
 */
export function cronRefusal(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET is not set' }, { status: 500 });
  }
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!secretsMatch(token, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
