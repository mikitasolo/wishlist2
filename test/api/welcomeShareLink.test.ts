import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'wishlist.test', 'x-forwarded-proto': 'https' })),
}));
// Only what the server page hands the form matters here.
vi.mock('@/components/WelcomeForm', () => ({ default: () => null }));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import WelcomePage from '@/app/welcome/page';
import type { WelcomeNextList } from '@/components/WelcomeForm';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';
import { blockFromShareLinks } from '@/lib/utils/linkBlocks';

/**
 * WIS-339: a new account's Welcome page, on its way back to a share link,
 * names the link's list only for a live link the viewer could open, resolved
 * as `/l/[token]` resolves it. Anything else names nothing, and a dead link
 * spends the IP's failed-lookup budget, so the page tests no tokens.
 */

const session = vi.mocked(auth);
const ORIGIN = 'https://wishlist.test';
let listId: string;
let newcomerId: string;
const counted: string[] = [];

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  counted.length = 0;
  __setRateLimiters({
    shareLinkInvalid: {
      async limit() {
        counted.push('shareLinkInvalid');
        return { success: true, reset: Date.now() + 60_000, limit: 30, remaining: 29 };
      },
    } as RateLimiter,
  });
  const owner = await User.create({ email: 'o@x.com', username: 'owner' });
  newcomerId = (await User.create({ email: 'n@x.com', username: 'user_abcd1234' }))._id.toString();
  listId = (
    await Wishlist.create({ name: 'Anna’s wedding', owners: [owner._id], visibility: 'private' })
  )._id.toString();
  session.mockResolvedValue({ user: { id: newcomerId } } as never);
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function nextListFor(callbackUrl?: string): Promise<WelcomeNextList | null> {
  const tree = (await WelcomePage({
    searchParams: Promise.resolve(callbackUrl === undefined ? {} : { callbackUrl }),
  })) as ReactElement<{ nextList: WelcomeNextList | null }>;
  expect(isValidElement(tree)).toBe(true);
  return tree.props.nextList;
}

async function link(level: 'view' | 'join' = 'join', over: Record<string, unknown> = {}) {
  return (await ShareLink.create({ wishlist: listId, token: generateShareToken(), level, ...over }))
    .token;
}

describe('Welcome on the way back to a share link', () => {
  it('names a live Join link’s list, from the absolute callback Auth.js passes', async () => {
    const token = await link('join');
    expect(await nextListFor(`${ORIGIN}/l/${token}?then=join`)).toEqual({
      name: 'Anna’s wedding',
      level: 'join',
    });
    expect(counted).toEqual([]);
  });

  it('names a live View link’s list from a relative callback', async () => {
    const token = await link('view');
    expect(await nextListFor(`/l/${token}?then=ask`)).toEqual({
      name: 'Anna’s wedding',
      level: 'view',
    });
  });

  it('names nothing for a dead link, and spends the failed-lookup budget', async () => {
    const expired = await link('join', { expiresAt: new Date(Date.now() - 1000) });
    const unknown = generateShareToken();
    for (const token of [expired, unknown]) {
      expect(await nextListFor(`${ORIGIN}/l/${token}`)).toBeNull();
    }
    expect(counted).toEqual(['shareLinkInvalid', 'shareLinkInvalid']);
  });

  it('names nothing for an archived list’s link', async () => {
    const token = await link('join');
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    expect(await nextListFor(`/l/${token}`)).toBeNull();
  });

  it('names nothing for someone kicked from the list, as for a revoked link', async () => {
    const token = await link('join');
    await blockFromShareLinks(listId, newcomerId);
    expect(await nextListFor(`/l/${token}`)).toBeNull();
    expect(counted).toEqual(['shareLinkInvalid']);
  });

  // regression: a failed read used to throw to the error page, and Auth.js
  // sends a new account to Welcome only once, so it lost its username step.
  it('still draws the welcome, naming nothing, when the lookup fails', async () => {
    const token = await link('join');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ShareLink, 'findOne').mockImplementationOnce(() => {
      throw new Error(`E11000 token ${token}`);
    });
    expect(await nextListFor(`/l/${token}`)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    // Logs carry no token.
    expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
  });

  it('names nothing, and looks nothing up, for any other destination', async () => {
    const token = await link('join');
    for (const callbackUrl of [
      undefined,
      '/invites',
      `https://evil.example/l/${token}`,
      `/l/${token}/extra`,
      '/l/short',
    ]) {
      expect(await nextListFor(callbackUrl), String(callbackUrl)).toBeNull();
    }
    expect(counted).toEqual([]);
  });
});
