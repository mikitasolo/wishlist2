import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// The real MongoDB adapter, on the in-memory database the models use.
vi.mock('@/lib/authAdapter', async () => {
  const { MongoDBAdapter } = await import('@auth/mongodb-adapter');
  const { default: db } = await import('mongoose');
  return { adapter: MongoDBAdapter(() => db.connection.getClient() as never) };
});

import { GET } from '@/app/api/auth/[...nextauth]/route';

/**
 * The magic link's callback through Auth.js itself, with a link it refuses.
 * regression: Auth.js redirects an expired or used link to
 * `/auth/error?error=Verification` without the link's `callbackUrl`, so Try
 * again lost the page the link was for and went home (WIS-305).
 */

const BASE = 'http://localhost:3000';
const EMAIL = 'friend@example.com';

function openLink(params: Record<string, string>) {
  const query = new URLSearchParams({ email: EMAIL, ...params });
  return GET(new NextRequest(`${BASE}/api/auth/callback/nodemailer?${query}`));
}

function redirectOf(res: Response) {
  expect(res.status).toBeGreaterThanOrEqual(300);
  expect(res.status).toBeLessThan(400);
  return new URL(res.headers.get('Location')!);
}

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/auth/callback/nodemailer with a link Auth.js refuses', () => {
  it('keeps the link’s destination on an expired link', async () => {
    // Stored as Auth.js stores it: hashed with the secret, here already expired.
    await mongoose.connection.collection('verification_tokens').insertOne({
      identifier: EMAIL,
      token: createHash('sha256')
        .update(`expired-token${process.env.NEXTAUTH_SECRET}`)
        .digest('hex'),
      expires: new Date(Date.now() - 60_000),
    });

    const res = await openLink({
      token: 'expired-token',
      callbackUrl: `${BASE}/wishlists/birthday?item=abc`,
    });

    const location = redirectOf(res);
    expect(location.origin).toBe(BASE);
    expect(location.pathname).toBe('/auth/error');
    expect(location.searchParams.get('error')).toBe('Verification');
    expect(location.searchParams.get('callbackUrl')).toBe('/wishlists/birthday?item=abc');
  });

  it('keeps the destination on a link that was already used (no token left)', async () => {
    const res = await openLink({ token: 'used-token', callbackUrl: '/booked' });

    const location = redirectOf(res);
    expect(location.pathname).toBe('/auth/error');
    expect(location.searchParams.get('callbackUrl')).toBe('/booked');
  });

  it.each([
    ['another host', 'https://evil.example/login'],
    ['a protocol-relative URL', '//evil.example/login'],
    ['a same-origin URL whose path is protocol-relative', `${BASE}//evil.example`],
    // (A `javascript:` URL never gets this far: Auth.js refuses it with a 500
    // of its own. The unit test covers dropping it.)
    ['an auth page, which would loop', `${BASE}/auth/signin`],
    ['home', `${BASE}/`],
  ])('drops a callbackUrl that is %s', async (_label, callbackUrl) => {
    const res = await openLink({ token: 'used-token', callbackUrl });

    const location = redirectOf(res);
    expect(location.origin).toBe(BASE);
    expect(location.pathname).toBe('/auth/error');
    expect(location.searchParams.get('error')).toBe('Verification');
    expect(location.searchParams.has('callbackUrl')).toBe(false);
  });

  it('adds nothing when the link carries no callbackUrl', async () => {
    const res = await openLink({ token: 'used-token' });

    expect(res.headers.get('Location')).toBe(`${BASE}/auth/error?error=Verification`);
  });

  it('never carries the email or the token into the redirect', async () => {
    const res = await openLink({ token: 'used-token', callbackUrl: '/booked' });

    const location = res.headers.get('Location')!;
    expect(location).not.toContain('used-token');
    expect(location).not.toContain('friend');
    expect([...redirectOf(res).searchParams.keys()].sort()).toEqual(['callbackUrl', 'error']);
  });
});
