import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'node:util';
import { SMTP_ENV_VARS, type EmailTransport } from '@/lib/env';

interface CapturedConfig {
  providers: Array<{ id: string; options: Record<string, unknown> }>;
  callbacks: {
    signIn: (args: { user: { email: string } }) => Promise<boolean>;
    session: (args: {
      session: { user: Record<string, unknown> };
      user: { id: string; email: string };
    }) => Promise<unknown>;
  };
}

// Capture the config lib/auth hands to NextAuth instead of booting Auth.js. The
// real Nodemailer provider still runs, so a missing `server` would throw here.
// The User model is stubbed so the callbacks run without a database.
const { nextAuth, users } = vi.hoisted(() => ({
  nextAuth: vi.fn((config: CapturedConfig) => {
    void config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
  users: { findOne: vi.fn(), create: vi.fn(), exists: vi.fn() },
}));
vi.mock('next-auth', () => ({ default: nextAuth }));
vi.mock('@/lib/authAdapter', () => ({ adapter: {} }));
vi.mock('@/lib/mongodb', () => ({ default: vi.fn() }));
vi.mock('@/models/User', () => ({ default: users }));

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

describe('lib/auth callbacks: logging', () => {
  const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
  const EMAIL = 'Alice.Smith@example.com';

  async function callbacks() {
    vi.resetModules();
    await import('@/lib/auth');
    return nextAuth.mock.calls[0]![0].callbacks;
  }

  let errorLog: ReturnType<typeof vi.spyOn>;
  /** Everything console.error printed, the way it prints it (stacks, props and all). */
  const logged = () =>
    errorLog.mock.calls.map((args: unknown[]) => format(...args).toLowerCase()).join('\n');

  beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    users.findOne.mockReset();
    users.create.mockReset();
    users.exists.mockReset().mockResolvedValue(null);
  });
  afterEach(() => errorLog.mockRestore());

  // regression: a session whose user row was missing logged
  // `User not found in database during session callback: <email>`, writing the
  // user's email to the server log, which everyone with project access reads.
  it('regression: the session callback logs a missing user without their email or id', async () => {
    users.findOne.mockResolvedValueOnce(null);
    const { session: sessionCallback } = await callbacks();

    const session = { user: {} };
    const result = await sessionCallback({ session, user: { id: USER_ID, email: EMAIL } });
    expect(result).toBe(session);

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(EMAIL.toLowerCase());
    expect(logged()).not.toContain('alice');
    expect(logged()).not.toContain(USER_ID);
  });

  // regression: two first sign-ins for one email race to create the user, and the
  // loser's duplicate-key error, logged whole, quotes the email
  // (`dup key: { email: "…" }`, plus `keyValue`).
  it('regression: the signIn callback logs a duplicate-key error without the email', async () => {
    users.findOne.mockResolvedValueOnce(null);
    users.create.mockRejectedValueOnce(
      Object.assign(
        new Error(
          `E11000 duplicate key error collection: test.users index: email_1 dup key: { email: "${EMAIL.toLowerCase()}" }`
        ),
        { code: 11000, keyValue: { email: EMAIL.toLowerCase() } }
      )
    );
    const { signIn } = await callbacks();

    expect(await signIn({ user: { email: EMAIL } })).toBe(false);
    expect(errorLog).toHaveBeenCalledWith('Error in signIn callback:', 'duplicate key');
    expect(logged()).not.toContain(EMAIL.toLowerCase());
  });

  it('still logs any other signIn error whole', async () => {
    const failure = new Error('connection refused');
    users.findOne.mockRejectedValueOnce(failure);
    const { signIn } = await callbacks();

    expect(await signIn({ user: { email: EMAIL } })).toBe(false);
    expect(errorLog).toHaveBeenCalledWith('Error in signIn callback:', failure);
  });
});
