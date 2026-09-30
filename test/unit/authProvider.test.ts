import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SMTP_ENV_VARS, type EmailTransport } from '@/lib/env';

interface CapturedConfig {
  providers: Array<{ id: string; options: Record<string, unknown> }>;
}

// Capture the config lib/auth hands to NextAuth instead of booting Auth.js. The
// real Nodemailer provider still runs, so a missing `server` would throw here.
const { nextAuth } = vi.hoisted(() => ({
  nextAuth: vi.fn((config: CapturedConfig) => {
    void config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
}));
vi.mock('next-auth', () => ({ default: nextAuth }));
vi.mock('@/lib/authAdapter', () => ({ adapter: {} }));
vi.mock('@/lib/mongodb', () => ({ default: vi.fn() }));

async function magicLinkProvider(transport: EmailTransport) {
  vi.stubEnv('EMAIL_TRANSPORT', transport);
  if (transport === 'console') {
    for (const name of SMTP_ENV_VARS) vi.stubEnv(name, undefined);
  }
  vi.resetModules();
  await import('@/lib/auth');
  const { sendVerificationRequest } = await import('@/lib/signInEmail');
  const provider = nextAuth.mock.calls[0]![0].providers.find((p) => p.id === 'nodemailer');
  return { options: provider!.options, sendVerificationRequest };
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', undefined);
  nextAuth.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('lib/auth magic-link provider', () => {
  it('builds without any SMTP config in console mode, on a transport that never sends', async () => {
    const { options, sendVerificationRequest } = await magicLinkProvider('console');

    expect(options.server).toEqual({ jsonTransport: true });
    expect(options.from).toBe('test@example.com');
    // Sign-in goes through our rate-limited sender, which honours EMAIL_TRANSPORT.
    expect(options.sendVerificationRequest).toBe(sendVerificationRequest);
  });

  it('points at the SMTP config in smtp mode', async () => {
    const { options, sendVerificationRequest } = await magicLinkProvider('smtp');

    expect(options.server).toEqual({
      host: 'localhost',
      port: 587,
      secure: false,
      auth: { user: 'test', pass: 'test' },
    });
    expect(options.sendVerificationRequest).toBe(sendVerificationRequest);
  });
});
