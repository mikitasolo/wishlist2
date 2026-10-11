/**
 * The browser side of error monitoring (WIS-381). The SDK and its setup
 * (`./browserSdk`, about 30 KiB gzipped) are loaded with a dynamic import, so
 * they're a chunk of their own that only a page where monitoring is on ever
 * fetches (`components/ErrorMonitoring.tsx`, which the root layout renders
 * only then), after it hydrates. Everywhere else this module costs the page a
 * few lines, and `reportError` keeps at most a few errors that are never sent.
 */

type Sdk = typeof import('./browserSdk');

let loading: Promise<Sdk | null> | null = null;

/**
 * Errors an error boundary caught before the SDK was started: a page that
 * breaks while it first renders does so before `ErrorMonitoring`'s effect has
 * run. Sent once it starts; capped, since where monitoring is off nothing ever
 * starts it.
 */
const pending: unknown[] = [];
const MAX_PENDING = 10;

/**
 * Loads and starts the SDK once (later calls share the first), then sends what
 * was caught before. A failed chunk load (a network blip, a blocker) leaves the
 * page unmonitored until the next call tries again.
 */
export function startBrowserMonitoring(dsn: string, release?: string): Promise<Sdk | null> {
  loading ??= import('./browserSdk')
    .then((sdk) => {
      sdk.start(dsn, release);
      for (const error of pending.splice(0)) sdk.captureException(error);
      return sdk;
    })
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/**
 * Reports an error a React error boundary caught (those never reach the global
 * handlers). An error with a `digest` was thrown on the server and already
 * reported there (`instrumentation.ts`), so it isn't sent twice.
 */
export function reportError(error: unknown): void {
  if (error instanceof Error && 'digest' in error && error.digest) return;
  if (!loading) {
    if (pending.length < MAX_PENDING) pending.push(error);
    return;
  }
  void loading.then((sdk) => sdk?.captureException(error));
}

/** Test-only: forget the loaded SDK and anything held back. */
export function resetBrowserMonitoringForTests(): void {
  loading = null;
  pending.length = 0;
}
