import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/users/me/route';
import User from '@/models/User';
import { profileChanges, profileSettings } from '@/lib/utils/profileSettings';

/**
 * PATCH /api/users/me answering the dashboard's currency prompt: either answer
 * sends `currencyChosen: true`, and "Use X" sends `defaultCurrency` with it.
 */

const session = vi.mocked(auth);
let userId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const user = await User.create({ email: 'new@example.com', username: 'newcomer' });
  userId = user._id.toString();
  session.mockResolvedValue({ user: { id: userId } } as never);
});

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

const stored = async () => (await User.findById(userId).lean())!;
/** Still on USD, with no answer recorded. */
async function expectUnanswered() {
  const user = await stored();
  expect(user.defaultCurrency).toBe('USD');
  expect(user.currencyChosenAt).toBeUndefined();
}

describe('PATCH /api/users/me — the currency prompt’s answer', () => {
  // Absent, not null: `$min` would keep a null forever.
  it('starts a new account unanswered, on USD, with no stamp at all', async () => {
    await expectUnanswered();
    expect(Object.keys(await stored())).not.toContain('currencyChosenAt');
  });

  it('“Use PLN”: saves the currency and stamps the answer with the server’s clock', async () => {
    const before = Date.now();

    const res = await patch({ defaultCurrency: 'PLN', currencyChosen: true });

    expect(res.status).toBe(200);
    expect((await res.json()).data.defaultCurrency).toBe('PLN');
    const user = await stored();
    expect(user.defaultCurrency).toBe('PLN');
    expect(user.currencyChosenAt).toBeInstanceOf(Date);
    expect(user.currencyChosenAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.currencyChosenAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('“Choose another currency”: stamps the answer and leaves the currency alone', async () => {
    const res = await patch({ currencyChosen: true });

    expect(res.status).toBe(200);
    const user = await stored();
    expect(user.defaultCurrency).toBe('USD');
    expect(user.currencyChosenAt).toBeInstanceOf(Date);
  });

  // Someone who picks USD in Settings has chosen it, and isn't asked again.
  it('counts a currency saved from Settings as the answer, USD included', async () => {
    expect((await patch({ defaultCurrency: 'USD' })).status).toBe(200);

    const user = await stored();
    expect(user.defaultCurrency).toBe('USD');
    expect(user.currencyChosenAt).toBeInstanceOf(Date);
  });

  // The settings form sends only what changed (`profileChanges`), so the
  // currency goes, and answers the prompt, only when it was changed there.
  it('counts a Settings save as the answer exactly when it changes the currency', async () => {
    const loaded = profileSettings(await stored());

    await patch(profileChanges({ ...loaded, bio: 'Hi' }, loaded));
    await expectUnanswered();

    await patch(profileChanges({ ...loaded, defaultCurrency: 'EUR' }, loaded));
    expect((await stored()).currencyChosenAt).toBeInstanceOf(Date);
  });

  it('doesn’t count a save that leaves the currency alone', async () => {
    expect((await patch({ bio: 'Hi', privacy: { searchable: false } })).status).toBe(200);

    expect((await stored()).currencyChosenAt).toBeUndefined();
  });

  it('keeps the first answer’s time when it’s answered again', async () => {
    const first = new Date('2026-09-01T10:00:00.000Z');
    await User.updateOne({ _id: userId }, { $set: { currencyChosenAt: first } });

    expect((await patch({ defaultCurrency: 'EUR', currencyChosen: true })).status).toBe(200);

    expect(await stored()).toMatchObject({ defaultCurrency: 'EUR', currencyChosenAt: first });
  });

  it('takes no time from the client', async () => {
    const before = Date.now();

    await patch({ currencyChosen: true, currencyChosenAt: '2000-01-01T00:00:00.000Z' });

    expect((await stored()).currencyChosenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  // Only ever `true`: nothing a client sends unanswers it.
  it.each([false, null, 'yes', 1])(
    'refuses currencyChosen %j, and writes nothing',
    async (flag) => {
      const res = await patch({ defaultCurrency: 'PLN', currencyChosen: flag });

      expect(res.status).toBe(400);
      await expectUnanswered();
    }
  );

  it('can’t be cleared once answered', async () => {
    const first = new Date('2026-09-01T10:00:00.000Z');
    await User.updateOne({ _id: userId }, { $set: { currencyChosenAt: first } });

    expect((await patch({ bio: 'Hi', currencyChosenAt: null })).status).toBe(200);
    expect((await patch({ currencyChosen: false })).status).toBe(400);

    expect((await stored()).currencyChosenAt).toEqual(first);
  });

  it('still validates the currency sent with it, and then stamps nothing', async () => {
    for (const defaultCurrency of ['PL', 'PLNX', '12$', '']) {
      const res = await patch({ defaultCurrency, currencyChosen: true });
      expect(res.status, defaultCurrency).toBe(400);
    }
    const res = await patch({ defaultCurrency: 'zl', currencyChosen: true });
    expect((await res.json()).error).toMatch(/currency/i);

    await expectUnanswered();
  });

  it('answers a signed-out caller with the 401, and writes nothing', async () => {
    session.mockResolvedValue(null as never);

    expect((await patch({ defaultCurrency: 'PLN', currencyChosen: true })).status).toBe(401);
    await expectUnanswered();
  });
});
