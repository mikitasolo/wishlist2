import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import * as route from '@/app/api/unsubscribe/route';
import User from '@/models/User';
import { unsubscribeQuery } from '@/lib/utils/unsubscribe';

const session = vi.mocked(auth);

function post(query: string) {
  // As a mail client sends RFC 8058's one-click POST: the link's query, a form body.
  return route.POST(
    new NextRequest(`http://localhost/api/unsubscribe?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
  );
}

let mia: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  mia = String(
    (
      await User.create({
        email: 'mia@example.com',
        username: 'mia',
        notificationPrefs: { join_request: { inApp: false }, proposal: { email: true } },
      })
    )._id
  );
});

const prefsOf = async (id: string) => (await User.findById(id).lean())?.notificationPrefs;

describe('POST /api/unsubscribe', () => {
  it("turns off that event's email only, signed out", async () => {
    const res = await post(unsubscribeQuery({ userId: mia, event: 'join_request' }));

    expect(res.status).toBe(200);
    expect(session).not.toHaveBeenCalled();
    expect(await prefsOf(mia)).toEqual({
      join_request: { inApp: false, email: false },
      proposal: { email: true },
    });
  });

  it('is idempotent', async () => {
    const query = unsubscribeQuery({ userId: mia, event: 'proposal' });
    expect((await post(query)).status).toBe(200);
    expect((await post(query)).status).toBe(200);
    expect((await prefsOf(mia))?.proposal).toEqual({ email: false });
  });

  it('says nothing about the account: no email, no name, and the same answer once it is gone', async () => {
    const res = await post(unsubscribeQuery({ userId: mia, event: 'proposal' }));
    const body = await res.text();
    expect(body).not.toContain('mia');
    expect(JSON.parse(body)).toEqual({ success: true, event: 'proposal' });

    const ghost = new mongoose.Types.ObjectId().toString();
    const gone = await post(unsubscribeQuery({ userId: ghost, event: 'proposal' }));
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ success: true, event: 'proposal' });
    expect(await User.exists({ _id: ghost })).toBeNull();
  });

  it("refuses a link moved to another account, and changes nobody's settings", async () => {
    const eve = String((await User.create({ email: 'eve@example.com', username: 'eve' }))._id);
    const signed = new URLSearchParams(unsubscribeQuery({ userId: eve, event: 'proposal' }));
    signed.set('u', mia);

    const res = await post(signed.toString());
    expect(res.status).toBe(400);
    expect((await prefsOf(mia))?.proposal).toEqual({ email: true });
    expect((await prefsOf(eve)) ?? {}).toEqual({});
  });

  it('refuses a link moved to another event', async () => {
    const signed = new URLSearchParams(unsubscribeQuery({ userId: mia, event: 'join_request' }));
    signed.set('e', 'proposal');
    expect((await post(signed.toString())).status).toBe(400);
    expect((await prefsOf(mia))?.proposal).toEqual({ email: true });
  });

  it('refuses a missing or forged signature', async () => {
    expect((await post(`u=${mia}&e=proposal`)).status).toBe(400);
    expect((await post(`u=${mia}&e=proposal&t=forged`)).status).toBe(400);
    expect((await prefsOf(mia))?.proposal).toEqual({ email: true });
  });

  it('acts on POST only, so a scanner opening the link changes nothing', () => {
    expect('GET' in route).toBe(false);
  });
});
