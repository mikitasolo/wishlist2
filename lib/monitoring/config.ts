import { scrubBreadcrumb, scrubEvent } from './scrub';

/**
 * Error monitoring (Sentry, WIS-381): when it's on, and the options both SDKs
 * share. Kept free of any SDK import, so the root layout and `instrumentation.ts`
 * can ask whether it's on without loading Sentry; each side imports its SDK
 * only once this says yes.
 */

/** The env var holding the Sentry project's DSN (server-read, never inlined). */
export const SENTRY_DSN_VAR = 'SENTRY_DSN';

/**
 * A Sentry DSN: `https://<public key>@<ingest host>/<project id>`. Anything else
 * is a typo, not a project. next.config.js holds a copy of this pattern for the
 * CSP (`sentryOrigin`), and `test/unit/nextConfig.test.ts` keeps them in step.
 */
const SENTRY_DSN_RE = /^https:\/\/[0-9a-f]+@[a-z0-9.-]+\.[a-z]{2,}\/\d+$/i;

/**
 * The DSN that turns error monitoring on, or `null` while it's off: only on
 * Vercel's Production (`VERCEL_ENV`), with `SENTRY_DSN` set to a well-formed
 * DSN, so local dev, CI, E2E, previews and staging load no SDK and send
 * nothing. Read at call time by a computed name, like the Umami id, so Next
 * never inlines it into a client bundle; the root layout hands it to the
 * browser (`components/ErrorMonitoring.tsx`).
 */
export function getSentryDsn(): string | null {
  if (process.env.VERCEL_ENV !== 'production') return null;
  const dsn = process.env[SENTRY_DSN_VAR]?.trim();
  return dsn && SENTRY_DSN_RE.test(dsn) ? dsn : null;
}

/** The deployment's commit, as Sentry's release (Vercel sets it at build and run time). */
export function getSentryRelease(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA || undefined;
}

/**
 * What every `Sentry.init` gets, server and browser: errors only (no
 * performance tracing, session replay or profiling: the free plan's quota is
 * for errors, and replay records the page), no personal data from the SDK
 * itself (`sendDefaultPii: false`; no `tracesSampleRate` either, since even 0
 * switches tracing on and adds trace headers to requests), and the scrub in `./scrub.ts` on every
 * event and breadcrumb as the backstop for what the SDK or our code puts in.
 */
export function sharedSentryOptions(dsn: string, release: string | undefined) {
  return {
    dsn,
    release,
    environment: 'production',
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    // `beforeSend` sees only error events; transactions never exist here.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  } as const;
}
