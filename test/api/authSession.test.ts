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
    });
    expect(SESSION_USER_FIELDS).toEqual(expect.arrayContaining(Object.keys(body.user)));
    expect(new Date(body.expires).getTime()).toBeGreaterThan(Date.now());
    for (const leak of [TOKEN, 'sessionToken', 'userId', '_id', 'emailVerified', 'Gardening']) {
      expect(text).not.toContain(leak);
    }
  });

  it('answers null without a session', async () => {
    const res = await getSession();
    expect(await res.json()).toBeNull();

    const unknown = await getSession('authjs.session-token=not-a-session');
    expect(await unknown.json()).toBeNull();
  });
});
