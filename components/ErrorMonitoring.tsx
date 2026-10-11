'use client';

import { useEffect } from 'react';
import { startBrowserMonitoring } from '@/lib/monitoring/browser';

/**
 * Starts browser error monitoring (Sentry, WIS-381) once the page hydrates.
 * Rendered by the root layout only when monitoring is on (`getSentryDsn`):
 * otherwise the SDK's chunk is never fetched and nothing is sent.
 */
export default function ErrorMonitoring({ dsn, release }: { dsn: string; release?: string }) {
  useEffect(() => {
    void startBrowserMonitoring(dsn, release);
  }, [dsn, release]);
  return null;
}
