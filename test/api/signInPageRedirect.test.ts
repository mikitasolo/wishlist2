import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sign-in page (a server component) against a mocked session: a visitor
// who's already signed in is sent on to the page's callbackUrl, if it's on
// this site, instead of being shown the email form.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));
// `redirect` throws, as Next's does, so nothing after it runs.
const { Redirected } = vi.hoisted(() => ({
  Redirected: class Redirected extends Error {
    constructor(readonly to: string) {
      super(`redirected to ${to}`);
    }
  },
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirected(to);
  }),
}));
// The form has its own tests (test/components/signin.test.tsx).
vi.mock('@/app/auth/signin/SignInForm', () => ({ default: () => null }));

import { auth } from '@/lib/auth';
import SignInPage from '@/app/auth/signin/page';

// What `auth()` resolves to for a signed-in visitor (sessionPayload's shape).
const SESSION = { user: { id: '64b000000000000000000001', username: 'alice' }, expires: '' };
// NEXTAUTH_URL in vitest.config.mts.
const ORIGIN = 'http://localhost:3000';

const session = vi.mocked(auth);

/** Where the page sends the visitor for these query params, or null when it renders the form. */
async function destination(query: Record<string, string | string[]> = {}) {
  try {
    await SignInPage({ searchParams: Promise.resolve(query) });
    return null;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
}

beforeEach(() => {
  session.mockReset();
  session.mockResolvedValue(SESSION as never);
});

describe('the sign-in page for a visitor who is already signed in', () => {
  // regression: the page never checked the session, so an invitee already
  // signed in who opened the invite email's link (`/auth/signin?callbackUrl=
  // /invites`) was shown "Welcome back — enter your email", and had to request
  // a magic link to reach a page they could already open.
  it('regression: goes straight on to the callbackUrl', async () => {
    expect(await destination({ callbackUrl: '/invites' })).toBe('/invites');
    expect(await destination({ callbackUrl: '/wishlists/abc?tab=items#top' })).toBe(
      '/wishlists/abc?tab=items#top'
    );
  });

  // What Auth.js's own sign-in redirect passes: the URL resolved on our origin.
  it('takes an absolute callbackUrl on this site to its path', async () => {
    expect(await destination({ callbackUrl: `${ORIGIN}/users/jane?x=1` })).toBe('/users/jane?x=1');
  });

  it('goes home without a callbackUrl', async () => {
    expect(await destination()).toBe('/');
    expect(await destination({ callbackUrl: '' })).toBe('/');
  });

  it('never leaves the site (no open redirect)', async () => {
    for (const offsite of [
      'https://evil.example/phish',
      '//evil.example/phish',
      '/\\evil.example/phish',
      'javascript:alert(1)',
      `${ORIGIN}//evil.example/phish`,
      'https://localhost:3000/invites', // another scheme is another origin
    ]) {
      expect(await destination({ callbackUrl: offsite }), offsite).toBe('/');
    }
  });

  it('never sends them back to an auth page, so it can’t loop', async () => {
    for (const authPage of [
      '/auth/signin',
      `/auth/signin?callbackUrl=${encodeURIComponent('/invites')}`,
      `${ORIGIN}/auth/signin`,
      '/auth/verify-request',
      '/auth/error?error=Verification',
    ]) {
      expect(await destination({ callbackUrl: authPage }), authPage).toBe('/');
    }
  });

  // `?callbackUrl=a&callbackUrl=b`: the first, as the form would read it.
  it('reads the first of a repeated callbackUrl', async () => {
    expect(await destination({ callbackUrl: ['/invites', 'https://evil.example/'] })).toBe(
      '/invites'
    );
    expect(await destination({ callbackUrl: ['https://evil.example/', '/invites'] })).toBe('/');
  });
});

describe('the sign-in page for a signed-out visitor', () => {
  it('shows the form, wherever the callbackUrl points', async () => {
    session.mockResolvedValue(null as never);
    expect(await destination({ callbackUrl: '/invites' })).toBeNull();
    expect(await destination({ callbackUrl: 'https://evil.example/' })).toBeNull();
  });

  // A session with no account behind it isn't a sign-in.
  it('shows the form for a session without a user id', async () => {
    session.mockResolvedValue({ user: {}, expires: '' } as never);
    expect(await destination({ callbackUrl: '/invites' })).toBeNull();
  });
});
