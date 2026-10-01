import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'node:util';
import { SMTP_ENV_VARS, type EmailTransport } from '@/lib/env';

interface CapturedConfig {
  providers: Array<{ id: string; options: Record<string, unknown> }>;
  pages: Record<string, string>;
  callbacks: {
    signIn: (args: { user: { email?: string | null } }) => Promise<boolean>;
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

  it('creates no account in the signIn callback, so it has nothing to fail on or log', async () => {
    const { signIn } = await callbacks();

    // Both the link request and the click run it; with an email it lets them through...
    expect(await signIn({ user: { email: EMAIL } })).toBe(true);
    // ...without one it refuses.
    expect(await signIn({ user: { email: null } })).toBe(false);
    // The adapter's createUser makes the account, on the first verified sign-in.
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe('lib/auth: sign-up', () => {
  async function config() {
    vi.resetModules();
    await import('@/lib/auth');
    return nextAuth.mock.calls[0]![0];
  }

  beforeEach(() => {
    users.findOne.mockReset();
    users.exists.mockReset().mockResolvedValue(null);
  });

  // Auth.js only redirects to pages.newUser when its adapter created the account
  // during that sign-in, which is why the signIn callback above creates none.
  it('sends a new account’s first sign-in to the welcome page', async () => {
    expect((await config()).pages.newUser).toBe('/welcome');
  });

  // regression: the lazy username backfill for legacy accounts called
  // generateUniqueUsername(dbUser.email), which built the handle from the
  // email's local part (alice.smith@… → @alicesmith).
  it('regression: backfills a legacy account with a random handle, not one from its email', async () => {
    const save = vi.fn();
    const dbUser = {
      _id: { toString: () => '64b7f0c2a1b2c3d4e5f60718' },
      email: 'alice.smith@example.com',
      username: undefined as string | undefined,
      image: null,
      defaultCurrency: 'USD',
      save,
    };
    users.findOne.mockResolvedValueOnce(dbUser);
    const { callbacks } = await config();

    const session = { user: {} as Record<string, unknown> };
    await callbacks.session({
      session,
      user: { id: '64b7f0c2a1b2c3d4e5f60718', email: 'alice.smith@example.com' },
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(dbUser.username).toMatch(/^user_[a-z0-9]{8}$/);
    expect(session.user.username).toBe(dbUser.username);
    for (const part of ['alice', 'smith', 'example']) {
      expect(dbUser.username).not.toContain(part);
    }
  });
});
