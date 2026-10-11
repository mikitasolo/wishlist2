import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSentryDsn, getSentryRelease, sharedSentryOptions } from '@/lib/monitoring/config';
import { scrubBreadcrumb, scrubEvent } from '@/lib/monitoring/scrub';

// WIS-381: error monitoring is on only on Production with a well-formed DSN;
// local dev, CI, E2E, previews and staging load no SDK and send nothing.

const DSN = 'https://0123456789abcdef0123456789abcdef@o4507.ingest.de.sentry.io/4507123';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSentryDsn', () => {
  it('answers the DSN on Production', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SENTRY_DSN', ` ${DSN} `);
    expect(getSentryDsn()).toBe(DSN);
  });

  it.each([
    ['unset on Production', 'production', undefined],
    ['empty on Production', 'production', ''],
    ['malformed on Production', 'production', 'not-a-dsn'],
    ['plain http on Production', 'production', DSN.replace('https', 'http')],
    ['staging / previews', 'preview', DSN],
    ['Vercel development', 'development', DSN],
    ['local dev, CI and E2E', undefined, DSN],
  ])('is off when %s', (_label, env, dsn) => {
    vi.stubEnv('VERCEL_ENV', env);
    vi.stubEnv('SENTRY_DSN', dsn);
    expect(getSentryDsn()).toBeNull();
  });
});

describe('getSentryRelease', () => {
  it('is the deployment’s commit, or none', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    expect(getSentryRelease()).toBe('abc123');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(getSentryRelease()).toBeUndefined();
  });
});

describe('sharedSentryOptions', () => {
  it('sends no personal data, traces nothing and scrubs every event and breadcrumb', () => {
    const options = sharedSentryOptions(DSN, 'abc');
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    // Even a 0 sample rate switches tracing on (and trace headers on requests).
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options).not.toHaveProperty('tracesSampler');
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
    expect(options).not.toHaveProperty('profilesSampleRate');
  });
});
