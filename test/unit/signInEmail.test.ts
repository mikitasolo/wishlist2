import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SMTP_ENV_VARS, type EmailTransport } from '@/lib/env';
import type { RateLimiter, RateLimitResult } from '@/lib/rateLimit';

// Stand-in for nodemailer: proves whether anything is ever sent.
const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const EMAIL = 'Friend@Example.com';
const MAGIC_LINK = 'http://localhost:3000/api/auth/callback/nodemailer?token=secret-token-123';

function limiter(success: boolean) {
  return {
    limit: vi.fn(async (): Promise<RateLimitResult> => ({
      success,
      reset: Date.now() + 60_000,
      limit: 3,
      remaining: success ? 2 : 0,
    })),
  } satisfies RateLimiter;
}

function verificationRequest() {
  return {
    identifier: EMAIL,
    url: MAGIC_LINK,
    request: new Request('http://localhost:3000/api/auth/signin/nodemailer', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    }),
  };
}

/**
 * Load the sign-in sender for a transport (console mode with no SMTP config at
 * all). lib/email reads the transport at import, and a fresh module graph means
 * a fresh rate-limit registry, so both come from the same re-import.
 */
async function load(transport: EmailTransport) {
  vi.stubEnv('EMAIL_TRANSPORT', transport);
  if (transport === 'console') {
    for (const name of SMTP_ENV_VARS) vi.stubEnv(name, undefined);
  }
  vi.resetModules();
  const [{ sendVerificationRequest }, { __setRateLimiters }] = await Promise.all([
    import('@/lib/signInEmail'),
    import('@/lib/rateLimit'),
  ]);
  return { sendVerificationRequest, __setRateLimiters };
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', undefined);
  createTransport.mockClear();
  sendMail.mockReset();
  sendMail.mockResolvedValue({ accepted: ['friend@example.com'], rejected: [] });
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendVerificationRequest in console mode', () => {
  it('prints the magic link when the rate limits allow it', async () => {
    const { sendVerificationRequest, __setRateLimiters } = await load('console');
    const signinEmail = limiter(true);
    const signinIp = limiter(true);
    __setRateLimiters({ signinEmail, signinIp });

    await sendVerificationRequest(verificationRequest());

    // Keyed on the normalized target email and the first x-forwarded-for hop.
    expect(signinEmail.limit).toHaveBeenCalledWith('friend@example.com');
    expect(signinIp.limit).toHaveBeenCalledWith('ip:203.0.113.7');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain(MAGIC_LINK);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('prints nothing when the limit store is down (sign-in fails closed)', async () => {
    const { sendVerificationRequest, __setRateLimiters } = await load('console');
    const down: RateLimiter = {
      async limit() {
        throw new Error('redis unreachable');
      },
    };
    __setRateLimiters({ signinEmail: down, signinIp: down });

    await expect(sendVerificationRequest(verificationRequest())).rejects.toThrow(
      'Too many sign-in attempts'
    );

    expect(log).not.toHaveBeenCalled();
  });
});

// The limiter runs before the email goes anywhere, so both transports are rate
// limited the same way: a blocked request is neither sent nor printed.
describe.each(['console', 'smtp'] as const)('a blocked sign-in with EMAIL_TRANSPORT=%s', (mode) => {
  it.each([
    ['signinEmail', () => ({ signinEmail: limiter(false), signinIp: limiter(true) })],
    ['signinIp', () => ({ signinEmail: limiter(true), signinIp: limiter(false) })],
  ])('is neither sent nor printed when %s blocks it', async (_name, limiters) => {
    const { sendVerificationRequest, __setRateLimiters } = await load(mode);
    __setRateLimiters(limiters());

    await expect(sendVerificationRequest(verificationRequest())).rejects.toThrow(
      'Too many sign-in attempts'
    );

    expect(log).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('sendVerificationRequest in smtp mode', () => {
  it('sends the magic link when the rate limits allow it', async () => {
    const { sendVerificationRequest, __setRateLimiters } = await load('smtp');
    __setRateLimiters({ signinEmail: limiter(true), signinIp: limiter(true) });

    await sendVerificationRequest(verificationRequest());

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ to: EMAIL });
  });
});
