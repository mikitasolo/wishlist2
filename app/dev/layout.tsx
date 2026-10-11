import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isLocalDevRuntime } from '@/lib/env';

/**
 * `/dev/*` is for local dev only (WIS-375): the app's plain 404 wherever
 * `EMAIL_TRANSPORT=console` isn't allowed (`isLocalDevRuntime`: `VERCEL_ENV`
 * unset or `development`), decided per request. Each page checks again itself.
 */
export const dynamic = 'force-dynamic';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (!isLocalDevRuntime()) notFound();
  return children;
}
