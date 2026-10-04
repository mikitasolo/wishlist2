import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// The real MongoDB adapter, on the in-memory database the models use (the app's
// own module would open a client on MONGODB_URI).
vi.mock('@/lib/authAdapter', async () => {
  const { MongoDBAdapter } = await import('@auth/mongodb-adapter');
  const { default: db } = await import('mongoose');
  return { adapter: MongoDBAdapter(() => db.connection.getClient() as never) };
});

import { handlers } from '@/lib/auth';
import User from '@/models/User';
import { SESSION_USER_FIELDS } from '@/lib/utils/sessionPayload';

/**
 * GET /api/auth/session through Auth.js itself (its session action, our
 * callback, the adapter), with a session cookie, the way a browser asks.
 */

const TOKEN = 'b9e2d4c6-3a1f-4e8b-a7d5-session-token';
let userId: string;

const getSession = (cookie?: string) =>
  handlers.GET(
    new NextRequest('http://localhost:3000/api/auth/session', {
      headers: cookie ? { cookie } : {},
    })
  );

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  const user = await User.create({
    email: 'alice@example.com',
    emailVerified: new Date(),
    username: 'alice',
    bio: 'Gardening',
  });
  userId = user._id.toString();
  await mongoose.connection.collection('sessions').insertOne({
    sessionToken: TOKEN,
    userId: user._id,
    expires: new Date(Date.now() + 30 * 86_400_000),
  });
});

describe('GET /api/auth/session', () => {
  // regression: the session callback returned Auth.js's `{ ...sessionRow, user }`
  // as is, so this response carried the raw session token and the user's row.
  it('regression: answers with the allowlisted session, without the token or the row', async () => {
    const res = await getSession(`authjs.session-token=${TOKEN}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(Object.keys(body).sort()).toEqual(['expires', 'user']);
    expect(body.user).toEqual({
      id: userId,
      email: 'alice@example.com',
      username: 'alice',
      defaultCurrency: 'USD',
      currencyChosen: false,
      newAccount: true,
    });
    expect(SESSION_USER_FIELDS).toEqual(expect.arrayContaining(Object.keys(body.user)));
    expect(new Date(body.expires).getTime()).toBeGreaterThan(Date.now());
    for (const leak of [TOKEN, 'sessionToken', 'userId', '_id', 'emailVerified', 'Gardening']) {
      expect(text).not.toContain(leak);
    }
  });

  // Auth.js's adapter has just read the account for this check; the callback
  // used to read it again through the model on every auth().
  it('reads the account once per check, through the adapter only', async () => {
    const findOne = vi.spyOn(User, 'findOne');

    const body = await (await getSession(`authjs.session-token=${TOKEN}`)).json();

    expect(body.user.username).toBe('alice');
    expect(findOne).not.toHaveBeenCalled();
    findOne.mockRestore();
  });

  // update() (settings, welcome) is just another check: the row is read afresh.
  it('shows a changed username on the next check', async () => {
    await User.updateOne({ _id: userId }, { $set: { username: 'alice_new' } });

    const body = await (await getSession(`authjs.session-token=${TOKEN}`)).json();

    expect(body.user.username).toBe('alice_new');
  });

  // The dashboard's currency prompt reads it from here: the adapter's raw row
  // carries the timestamp as a Date, and only the yes or no goes out.
  it('says whether they’ve answered the currency prompt, without the timestamp', async () => {
    await User.updateOne(
      { _id: userId },
      { $set: { currencyChosenAt: new Date('2026-10-02T12:00:00.000Z') } }
    );

    const res = await getSession(`authjs.session-token=${TOKEN}`);
    const text = await res.text();

    expect(JSON.parse(text).user.currencyChosen).toBe(true);
    expect(text).not.toContain('currencyChosenAt');
    expect(text).not.toContain('2026-10-02');
  });

  it('backfills a legacy account’s username once, and fills in the defaults its raw row lacks', async () => {
    // A row from before usernames, written raw: no username, no schema defaults.
    const legacy = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('users').insertOne({
      _id: legacy,
      email: 'legacy@example.com',
      emailVerified: new Date(),
    });
    await mongoose.connection.collection('sessions').insertOne({
      sessionToken: 'legacy-session',
      userId: legacy,
      expires: new Date(Date.now() + 86_400_000),
    });
    const findOne = vi.spyOn(User, 'findOne');

    const first = await (await getSession('authjs.session-token=legacy-session')).json();

    expect(first.user).toEqual({
      id: legacy.toString(),
      email: 'legacy@example.com',
      username: expect.stringMatching(/^user_[a-z0-9]{8}$/),
      defaultCurrency: 'USD',
      currencyChosen: false,
      newAccount: true,
    });
    expect((await User.findById(legacy).lean())!.username).toBe(first.user.username);
    // One read of the account (the generator's own `exists` checks also run
    // through findOne, so count the lookup by email).
    const accountReads = findOne.mock.calls.filter(([filter]) => filter && 'email' in filter);
    expect(accountReads).toHaveLength(1);

    // From then on its row has one, so checks are back to the adapter's read.
    findOne.mockClear();
    const next = await (await getSession('authjs.session-token=legacy-session')).json();
    expect(next.user.username).toBe(first.user.username);
    expect(findOne).not.toHaveBeenCalled();
    findOne.mockRestore();
  });

  it('answers null without a session', async () => {
    const res = await getSession();
    expect(await res.json()).toBeNull();

    const unknown = await getSession('authjs.session-token=not-a-session');
    expect(await unknown.json()).toBeNull();
  });
});
