import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateEnvVars, getEnvVars, SMTP_ENV_VARS } from '@/lib/env';

// vitest.config.ts injects a full dummy SMTP config (EMAIL_TRANSPORT=smtp);
// each test strips or overrides what it needs and `unstubAllEnvs` puts it back.
function withoutSmtp() {
  for (const name of SMTP_ENV_VARS) vi.stubEnv(name, undefined);
}

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected it to throw');
}

beforeEach(() => {
  // Not on Vercel unless a test says so, whatever the shell running the suite has.
  vi.stubEnv('VERCEL_ENV', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('validateEnvVars: EMAIL_TRANSPORT', () => {
  // Local dev, CI and E2E (VERCEL_ENV unset, as beforeEach leaves it) and
  // Vercel's Development environment are the only places console mode may run.
  it('passes without any SMTP_* vars when EMAIL_TRANSPORT=console and VERCEL_ENV is unset', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).not.toThrow();
  });

  it('fails without SMTP_* vars when EMAIL_TRANSPORT is unset (smtp is the default)', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', undefined);
    const message = errorMessage(validateEnvVars);
    expect(message).toMatch(/^Missing required environment variables/);
    for (const name of SMTP_ENV_VARS) expect(message).toContain(name);
    // Points local dev at the way out.
    expect(message).toContain('EMAIL_TRANSPORT=console');
  });

  it('fails without SMTP_* vars when EMAIL_TRANSPORT=smtp', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    expect(() => validateEnvVars()).toThrow(/SMTP_HOST/);
  });

  it('treats an empty EMAIL_TRANSPORT as the smtp default', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', '');
    expect(() => validateEnvVars()).toThrow(/SMTP_HOST/);
  });

  it('fails when a single SMTP_* var is missing in smtp mode', () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    vi.stubEnv('SMTP_PASSWORD', undefined);
    expect(() => validateEnvVars()).toThrow(/SMTP_PASSWORD/);
  });

  it('still requires EMAIL_FROM in console mode', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    vi.stubEnv('EMAIL_FROM', undefined);
    expect(() => validateEnvVars()).toThrow(/EMAIL_FROM/);
  });

  it('throws for an unknown EMAIL_TRANSPORT instead of falling back', () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'sendgrid');
    expect(() => validateEnvVars()).toThrow(
      'Invalid EMAIL_TRANSPORT "sendgrid": expected "smtp" (the default) or "console".'
    );
  });

  it('is case-sensitive: "Console" is not the console transport', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', 'Console');
    expect(() => validateEnvVars()).toThrow(/Invalid EMAIL_TRANSPORT/);
  });

  it('allows console mode on VERCEL_ENV=development', () => {
    withoutSmtp();
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).not.toThrow();
  });

  it('refuses EMAIL_TRANSPORT=console in production, even with SMTP configured', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).toThrow(
      'EMAIL_TRANSPORT=console is not allowed with VERCEL_ENV="production"'
    );
  });

  it('refuses EMAIL_TRANSPORT=console in production without SMTP configured', () => {
    withoutSmtp();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).toThrow(/EMAIL_TRANSPORT=console is not allowed/);
  });

  // regression: the check only refused VERCEL_ENV=production, so a Preview
  // deployment (the staging URL, used by real staging accounts) accepted the
  // console transport and printed every magic link, a working sign-in
  // credential, to Vercel's runtime logs.
  it('refuses EMAIL_TRANSPORT=console on a preview deployment', () => {
    withoutSmtp();
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).toThrow(
      'EMAIL_TRANSPORT=console is not allowed with VERCEL_ENV="preview"'
    );
  });

  // An allow-list, not a deny-list: a value it doesn't know (including an
  // empty one, which is set, not unset) fails closed.
  it.each(['staging', ''])('refuses console mode on VERCEL_ENV="%s"', (vercelEnv) => {
    withoutSmtp();
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => validateEnvVars()).toThrow(
      `EMAIL_TRANSPORT=console is not allowed with VERCEL_ENV="${vercelEnv}"`
    );
  });

  it('allows smtp mode on a preview deployment', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    expect(() => validateEnvVars()).not.toThrow();
  });

  it('allows smtp mode in production', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    expect(() => validateEnvVars()).not.toThrow();
  });
});

describe('getEnvVars: EMAIL_TRANSPORT', () => {
  it('defaults to smtp and returns the SMTP config', () => {
    vi.stubEnv('EMAIL_TRANSPORT', undefined);
    const env = getEnvVars();
    expect(env.EMAIL_TRANSPORT).toBe('smtp');
    if (env.EMAIL_TRANSPORT !== 'smtp') throw new Error('unreachable');
    expect(env.SMTP_HOST).toBe('localhost');
    expect(env.SMTP_PORT).toBe('587');
    expect(env.EMAIL_FROM).toBe('test@example.com');
  });

  it('returns console mode with no SMTP config', () => {
    withoutSmtp();
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    const env = getEnvVars();
    expect(env.EMAIL_TRANSPORT).toBe('console');
    expect(env).not.toHaveProperty('SMTP_HOST');
    expect(env.EMAIL_FROM).toBe('test@example.com');
  });

  it.each(['preview', 'production'])('throws for console mode on VERCEL_ENV=%s', (vercelEnv) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    vi.stubEnv('EMAIL_TRANSPORT', 'console');
    expect(() => getEnvVars()).toThrow(/EMAIL_TRANSPORT=console is not allowed/);
  });
});
