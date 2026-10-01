import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import type { MongoClient } from 'mongodb';
import type { Adapter } from 'next-auth/adapters';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The cookies the sign-up request carries, per test.
const { jar, cookiesFails } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  cookiesFails: { error: null as Error | null },
}));
vi.mock('next/headers', () => ({
  cookies: async () => {
    if (cookiesFails.error) throw cookiesFails.error;
    return { get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) };
  },
}));

import User from '@/models/User';
import { SESSION_COOKIE_NAMES, endPreviousSession } from '@/lib/utils/previousSession';

/**
 * events.signIn (lib/auth.ts): a sign-in that created a new account ends the
 * session the browser carried for another account. Runs against the real
 * MongoDB adapter, the one lib/authAdapter.ts wraps, on the in-memory database.
 */

let adapter: Required<Pick<Adapter, 'createSession' | 'getSessionAndUser' | 'deleteSession'>>;
const sessions = () => mongoose.connection.collection('sessions');
let alice: mongoose.Types.ObjectId;
let newcomer: mongoose.Types.ObjectId;

async function seedSession(sessionToken: string, userId: mongoose.Types.ObjectId) {
  await adapter.createSession({
    sessionToken,
    userId: userId.toString(),
    expires: new Date(Date.now() + 86_400_000),
  });
}
const tokensLeft = async () =>
  (await sessions().find({}).toArray()).map((s) => s.sessionToken).sort();

let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((args: unknown[]) => format(...args)).join('\n');

beforeAll(async () => {
  await connectTestDB();
  // The client mongoose is connected with. Mongoose bundles its own copy of
  // the driver, so its MongoClient type differs from the adapter's, not the client.
  adapter = MongoDBAdapter(
    mongoose.connection.getClient() as unknown as MongoClient
  ) as typeof adapter;
});
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  jar.clear();
  cookiesFails.error = null;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  alice = (await User.create({ email: 'alice@example.com', username: 'alice' }))._id;
  newcomer = (await User.create({ email: 'new@example.com', username: 'user_abcd1234' }))._id;
});
// Also undoes a spy a failed test left behind, so it can't break the next one's setup.
afterEach(() => vi.restoreAllMocks());

describe('endPreviousSession', () => {
  // regression: WIS-82 moved account creation from the magic-link request to
  // the first verified sign-in, so a sign-up now takes Auth.js's new-user
  // branch, which (unlike its existing-user branch) never deletes the session
  // the request carried. A browser signed in as Alice that opened a sign-up
  // link for a new email left Alice's session valid until it expired.
  it('regression: ends the session the sign-up request carried for another account', async () => {
    await seedSession('alice-laptop', alice);
    await seedSession('alice-phone', alice);
    await seedSession('newcomer-session', newcomer); // the sign-up's own, just created
    jar.set('authjs.session-token', 'alice-laptop');

    await endPreviousSession(adapter, newcomer.toString());

    // Only the one this browser held: Alice stays signed in on her phone.
    expect(await tokensLeft()).toEqual(['alice-phone', 'newcomer-session']);
    expect(await adapter.getSessionAndUser('alice-laptop')).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('reads the https cookie name too', async () => {
    await seedSession('alice-laptop', alice);
    jar.set('__Secure-authjs.session-token', 'alice-laptop');

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual([]);
  });

  it('reads the cookies Auth.js actually names its session with', async () => {
    // Auth.js's own cookie defaults, from the @auth/core next-auth runs on (it
    // isn't in the package's exports, so located through next-auth).
    const require = createRequire(import.meta.url);
    const core = createRequire(require.resolve('next-auth/package.json')).resolve('@auth/core');
    const { defaultCookies } = await import(
      pathToFileURL(path.join(path.dirname(core), 'lib/utils/cookie.js')).href
    );

    expect([...SESSION_COOKIE_NAMES].sort()).toEqual(
      [defaultCookies(true).sessionToken.name, defaultCookies(false).sessionToken.name].sort()
    );
  });

  it('ends each carried session on its own, so one failing doesn’t keep the other', async () => {
    await seedSession('alice-https', alice);
    await seedSession('alice-http', alice);
    jar.set('__Secure-authjs.session-token', 'alice-https');
    jar.set('authjs.session-token', 'alice-http');
    vi.spyOn(adapter, 'deleteSession').mockRejectedValueOnce(new Error('timed out'));

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual(['alice-https']);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the request carried no session', async () => {
    await seedSession('alice-laptop', alice);
    jar.set('unrelated', 'alice-laptop');

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual(['alice-laptop']);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('does nothing when the carried session is already gone', async () => {
    await seedSession('alice-phone', alice);
    jar.set('authjs.session-token', 'expired-and-deleted');

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual(['alice-phone']);
    expect(errorLog).not.toHaveBeenCalled();
  });

  // As Auth.js does: a session whose user can't be found isn't the new account's.
  it('ends a carried session whose account no longer exists', async () => {
    await seedSession('orphan', new mongoose.Types.ObjectId());
    jar.set('authjs.session-token', 'orphan');

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual([]);
  });

  // Two links for one new email clicked in one browser: the second sign-in
  // carries the first one's session, which is already the new account's.
  it('keeps a session that is already the new account’s', async () => {
    await seedSession('newcomer-first-tab', newcomer);
    jar.set('authjs.session-token', 'newcomer-first-tab');

    await endPreviousSession(adapter, newcomer.toString());

    expect(await tokensLeft()).toEqual(['newcomer-first-tab']);
  });

  it('swallows a database failure, logging its kind without the token or user id', async () => {
    await seedSession('alice-laptop', alice);
    jar.set('authjs.session-token', 'alice-laptop');
    const outage = Object.assign(new Error(`connection lost while deleting alice-laptop`), {
      name: 'MongoNetworkError',
      code: 'ECONNRESET',
    });
    vi.spyOn(adapter, 'deleteSession').mockRejectedValueOnce(outage);

    await expect(endPreviousSession(adapter, newcomer.toString())).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('MongoNetworkError');
    expect(logged()).not.toContain('alice-laptop');
    expect(logged()).not.toContain(newcomer.toString());
  });

  it('swallows a failure to read the cookies', async () => {
    cookiesFails.error = new Error('cookies was called outside a request scope');

    await expect(endPreviousSession(adapter, newcomer.toString())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
