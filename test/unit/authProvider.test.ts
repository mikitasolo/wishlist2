import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'node:util';
import { SMTP_ENV_VARS, type EmailTransport } from '@/lib/env';
import { SESSION_USER_FIELDS } from '@/lib/utils/sessionPayload';

interface CapturedConfig {
  providers: Array<{ id: string; options: Record<string, unknown> }>;
  pages: Record<string, string>;
  events: { signIn: (args: { user: { id?: string }; isNewUser?: boolean }) => Promise<void> };
  callbacks: {
    signIn: (args: {
      user: { email?: string | null };
      email?: { verificationRequest?: boolean };
    }) => Promise<boolean>;
    session: (args: {
      session: Record<string, unknown>;
      user: Record<string, unknown>;
    }) => Promise<Record<string, unknown> & { user: Record<string, unknown> }>;
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
const { endPreviousSession } = vi.hoisted(() => ({ endPreviousSession: vi.fn() }));
vi.mock('@/lib/utils/previousSession', () => ({ endPreviousSession }));

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

    const result = await sessionCallback({
      session: { user: {}, expires: new Date() },
      user: { id: USER_ID, email: EMAIL },
    });
    // Still signed in, on the adapter's row.
    expect(result.user.id).toBe(USER_ID);

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
  // Auth.js's new-user branch doesn't end the session the browser carried, the
  // way its existing-user branch does; this event does it instead, once the new
  // account's session exists (covered in test/api/previousSession.test.ts).
  it('ends the browser’s previous session once a sign-in has created an account', async () => {
    endPreviousSession.mockReset();
    const { events } = await config();
    const { adapter } = await import('@/lib/authAdapter');

    await events.signIn({ user: { id: '64b7f0c2a1b2c3d4e5f60718' }, isNewUser: true });
    expect(endPreviousSession).toHaveBeenCalledExactlyOnceWith(adapter, '64b7f0c2a1b2c3d4e5f60718');

    // Signing in to an existing account: Auth.js ends the old session itself.
    endPreviousSession.mockClear();
    await events.signIn({ user: { id: '64b7f0c2a1b2c3d4e5f60718' }, isNewUser: false });
    await events.signIn({ user: { id: '64b7f0c2a1b2c3d4e5f60718' } });
    await events.signIn({ user: {}, isNewUser: true });
    expect(endPreviousSession).not.toHaveBeenCalled();
  });

  // endPreviousSession reads Auth.js's default session cookie names; a cookie
  // override here would rename the cookie and quietly turn that cleanup off.
  it('keeps Auth.js’s default session cookie, which endPreviousSession reads', async () => {
    const auth = (await config()) as unknown as Record<string, unknown>;
    expect(auth.cookies).toBeUndefined();
    expect(auth.useSecureCookies).toBeUndefined();
  });

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

    const result = await callbacks.session({
      session: { user: {}, expires: new Date() },
      user: { id: '64b7f0c2a1b2c3d4e5f60718', email: 'alice.smith@example.com' },
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(dbUser.username).toMatch(/^user_[a-z0-9]{8}$/);
    expect(result.user.username).toBe(dbUser.username);
    for (const part of ['alice', 'smith', 'example']) {
      expect(dbUser.username).not.toContain(part);
    }
  });
});

// A magic link is only sent from the sign-in form's server action, after its
// Turnstile check (`asVerifiedSignIn`). Auth.js asks the signIn callback first,
// with `verificationRequest`, so an unchecked request is refused there, before
// anything is sent. (No account is made at that point either way: the adapter's
// createUser makes it on the first verified sign-in.)
describe('lib/auth callbacks: the magic-link request', () => {
  const EMAIL = 'new.person@example.com';

  async function load() {
    vi.resetModules();
    await import('@/lib/auth');
    const { asVerifiedSignIn } = await import('@/lib/signInEmail');
    return { callbacks: nextAuth.mock.calls[0]![0].callbacks, asVerifiedSignIn };
  }

  beforeEach(() => {
    users.findOne.mockReset().mockResolvedValue(null);
    users.create.mockReset().mockResolvedValue({ email: EMAIL });
    users.exists.mockReset().mockResolvedValue(null);
  });

  it('refuses it outside the sign-in form', async () => {
    const { callbacks } = await load();

    expect(
      await callbacks.signIn({ user: { email: EMAIL }, email: { verificationRequest: true } })
    ).toBe(false);
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('allows it from the sign-in form, still without creating the account', async () => {
    const { callbacks, asVerifiedSignIn } = await load();

    const allowed = await asVerifiedSignIn(() =>
      callbacks.signIn({ user: { email: EMAIL }, email: { verificationRequest: true } })
    );
    expect(allowed).toBe(true);
    expect(users.create).not.toHaveBeenCalled();
  });

  // The link's own callback (GET /api/auth/callback/nodemailer) asks again,
  // without verificationRequest and from outside the action.
  it('allows the click on the link', async () => {
    const { callbacks } = await load();

    expect(await callbacks.signIn({ user: { email: EMAIL } })).toBe(true);
    expect(
      await callbacks.signIn({ user: { email: EMAIL }, email: { verificationRequest: false } })
    ).toBe(true);
  });
});

describe('lib/auth: the session payload', () => {
  const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
  const TOKEN = 'a7c3e1f0-6d2b-4c8e-9f1a-session-token';
  const EXPIRES = new Date('2026-10-31T12:00:00.000Z');

  /** The adapter's user row, the way Auth.js passes it (`_id` already mapped to `id`): every field it has. */
  const userRow = () => ({
    id: USER_ID,
    email: 'alice.smith@example.com',
    emailVerified: new Date('2026-10-01T00:00:00Z'),
    username: 'alice',
    image: 'https://blob.example/uploads/me/a.webp',
    bio: 'Gardening',
    defaultCurrency: 'EUR',
    privacy: { searchable: true, whoCanInvite: 'everyone', profileVisibility: 'everyone' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    __v: 0,
  });
  /** What Auth.js passes as `session` with database sessions: `{ ...sessionRow, user }`. */
  const sessionArg = () => ({
    id: 'sess-row-id',
    sessionToken: TOKEN,
    userId: USER_ID,
    expires: EXPIRES,
    user: userRow(),
  });
  const dbUser = () => ({
    _id: { toString: () => USER_ID },
    email: 'alice.smith@example.com',
    username: 'alice',
    image: 'https://blob.example/uploads/me/a.webp',
    defaultCurrency: 'EUR',
    save: vi.fn(),
  });

  async function sessionCallback() {
    vi.resetModules();
    await import('@/lib/auth');
    return nextAuth.mock.calls[0]![0].callbacks.session;
  }

  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    users.findOne.mockReset();
  });
  afterEach(() => errorLog.mockRestore());

  // regression: the session callback returned the object Auth.js passed it as
  // is, and with database sessions that's `{ ...sessionRow, user }`, so
  // GET /api/auth/session handed any script on the page the raw session token
  // (the one the httpOnly cookie keeps from scripts), its row's ids, and every
  // field of the user's row.
  it('regression: returns only the allowlisted fields, never the session token or a raw row field', async () => {
    users.findOne.mockResolvedValueOnce(dbUser());
    const callback = await sessionCallback();

    const result = await callback({ session: sessionArg(), user: userRow() });

    // Exact: a new field fails here until it's added to the allowlist on purpose.
    expect(result).toEqual({
      user: {
        id: USER_ID,
        email: 'alice.smith@example.com',
        username: 'alice',
        name: undefined,
        image: 'https://blob.example/uploads/me/a.webp',
        defaultCurrency: 'EUR',
      },
      expires: '2026-10-31T12:00:00.000Z',
    });
    expect(Object.keys(result).sort()).toEqual(['expires', 'user']);
    expect(Object.keys(result.user).sort()).toEqual([...SESSION_USER_FIELDS].sort());
    const wire = JSON.stringify(result);
    for (const leak of [TOKEN, 'sessionToken', 'userId', 'sess-row-id', 'emailVerified', 'bio']) {
      expect(wire).not.toContain(leak);
    }
  });

  it('builds a new object rather than returning or editing the one passed in', async () => {
    users.findOne.mockResolvedValueOnce(dbUser());
    const callback = await sessionCallback();
    const passed = sessionArg();

    const result = await callback({ session: passed, user: userRow() });

    expect(result).not.toBe(passed);
    expect(result.user).not.toBe(passed.user);
    expect(passed.user).toEqual(userRow());
  });

  // Not found, or the read failed: still signed in on the adapter's row, as
  // before, but through the same allowlist.
  it.each([
    ['the account isn’t found', () => users.findOne.mockResolvedValueOnce(null)],
    [
      'the database read fails',
      () => users.findOne.mockRejectedValueOnce(new Error('connection refused')),
    ],
  ])('keeps the allowlist when %s', async (_, arrange) => {
    arrange();
    const callback = await sessionCallback();

    const result = await callback({ session: sessionArg(), user: userRow() });

    expect(result).toEqual({
      user: {
        id: USER_ID,
        email: 'alice.smith@example.com',
        username: 'alice',
        name: undefined,
        image: 'https://blob.example/uploads/me/a.webp',
        defaultCurrency: 'EUR',
      },
      expires: '2026-10-31T12:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  // update() (settings, welcome) re-runs the callback: it reads the account
  // again rather than taking anything the client sent.
  it('reflects a changed username on the next read, and ignores what update() sends', async () => {
    users.findOne.mockResolvedValueOnce({ ...dbUser(), username: 'alice_new' });
    const callback = await sessionCallback();

    const result = await callback({
      session: sessionArg(),
      user: userRow(),
      newSession: { user: { username: 'forged', id: 'someone-else' } },
      trigger: 'update',
    } as never);

    // All of it from the account; none of what the client sent.
    expect(result).toEqual({
      user: {
        id: USER_ID,
        email: 'alice.smith@example.com',
        username: 'alice_new',
        name: undefined,
        image: 'https://blob.example/uploads/me/a.webp',
        defaultCurrency: 'EUR',
      },
      expires: '2026-10-31T12:00:00.000Z',
    });
  });

  // A username backfill that loses a race fails on the unique index, and that
  // error quotes the clashing username.
  it('logs a duplicate-key error by its kind only', async () => {
    const legacy = { ...dbUser(), username: undefined as string | undefined };
    legacy.save.mockRejectedValueOnce(
      Object.assign(new Error('E11000 dup key: { username: "user_clash000" }'), { code: 11000 })
    );
    users.findOne.mockResolvedValueOnce(legacy);
    users.exists.mockResolvedValue(null);
    const callback = await sessionCallback();

    const result = await callback({ session: sessionArg(), user: userRow() });

    expect(errorLog).toHaveBeenCalledWith('Error in session callback:', 'duplicate key');
    expect(format(...errorLog.mock.calls[0])).not.toContain('user_clash000');
    // Still signed in, on the adapter's row.
    expect(result.user.username).toBe('alice');
  });

  // Fail closed: Auth.js answers a callback that throws with no session.
  it('refuses a session it can’t name a user id for', async () => {
    users.findOne.mockRejectedValueOnce(new Error('connection refused'));
    const callback = await sessionCallback();
    const { id: _, ...withoutId } = userRow();
    void _;

    await expect(callback({ session: sessionArg(), user: withoutId })).rejects.toThrow(
      'No user id for the session'
    );
  });
});
