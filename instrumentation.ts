import type { Instrumentation } from 'next';
import { getSentryDsn, getSentryRelease, sharedSentryOptions } from '@/lib/monitoring/config';

/**
 * Server error monitoring (Sentry, WIS-381): only where `getSentryDsn` answers
 * (Production with `SENTRY_DSN` set). Everywhere else the SDK isn't even
 * imported and `onRequestError` does nothing. Every event and breadcrumb goes
 * through the scrub in `lib/monitoring/scrub.ts`.
 *
 * Reported: what Next hands `onRequestError` (an uncaught error in a page, a
 * route handler or a server action), process-level crashes, and every
 * `console.error`. The last is how a route's own `catch` (which logs and
 * answers 500) is seen at all; those lines already carry no personal data
 * (docs/agents/backend.md), and the scrub is the backstop.
 */

let captureRequestError: Instrumentation.onRequestError | null = null;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const dsn = getSentryDsn();
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    ...sharedSentryOptions(dsn, getSentryRelease()),
    // Node prints its own process warnings (`(node:6) ExperimentalWarning: …`)
    // to stderr through console.error, so the console integration would
    // report one per cold start. They're the runtime's, not our errors.
    ignoreErrors: [/^\(node:\d+\) \w*Warning: /],
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      // Next also console.errors what it hands onRequestError. The SDK skips
      // an error object it already sent; this also drops a back-to-back
      // repeat that isn't the same object (the free plan's quota is in
      // errors). Not on by default on Node.
      Sentry.dedupeIntegration(),
    ],
  });
  captureRequestError = Sentry.captureRequestError;
}

export const onRequestError: Instrumentation.onRequestError = (...args) =>
  captureRequestError?.(...args);
