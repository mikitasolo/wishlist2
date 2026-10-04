import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The Auth.js route, around a stubbed Auth.js: what gets through to it.
const { handlers } = vi.hoisted(() => ({
  handlers: {
    GET: vi.fn(async () => new Response('auth get')),
    POST: vi.fn(async () => new Response('auth post')),
  },
}));
vi.mock('@/lib/auth', () => ({ handlers }));

import { GET, POST } from '@/app/api/auth/[...nextauth]/route';

const BASE = 'http://localhost:3000';

function post(path: string) {
  return new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
    body: new URLSearchParams({ email: 'friend@example.com', csrfToken: 'token' }),
  });
}

beforeEach(() => {
  handlers.GET.mockClear();
  handlers.POST.mockClear();
});

describe('POST /api/auth/[...nextauth]', () => {
  // A magic link is only sent by the sign-in form's server action, after its
  // Turnstile check. Auth.js's own sign-in POST would send one past it, so it
  // never reaches Auth.js.
  it.each([
    '/api/auth/signin/nodemailer',
    '/api/auth//signin/nodemailer',
    '/api/auth/signin/other',
  ])('refuses %s with a 403 before Auth.js runs', async (path) => {
    const res = await POST(post(path));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Sign in from the sign-in page.' });
    expect(handlers.POST).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/signout', '/api/auth/session', '/api/auth/callback/nodemailer'])(
    'passes %s through to Auth.js',
    async (path) => {
      const request = post(path);
      const res = await POST(request);

      expect(await res.text()).toBe('auth post');
      expect(handlers.POST).toHaveBeenCalledWith(request);
    }
  );
});

describe('GET /api/auth/[...nextauth]', () => {
  const get = (path: string) => new NextRequest(`${BASE}${path}`);

  it("passes Auth.js's answer through untouched when it isn't a refused magic link", async () => {
    const answer = Response.redirect(`${BASE}/wishlists/birthday`);
    handlers.GET.mockResolvedValueOnce(answer);
    const request = get('/api/auth/callback/nodemailer?token=t&callbackUrl=%2Fbooked');

    expect(await GET(request)).toBe(answer);
    expect(handlers.GET).toHaveBeenCalledWith(request);
  });

  it('adds the callbackUrl only on the magic link’s own callback', async () => {
    const answer = Response.redirect(`${BASE}/auth/error?error=Verification`);
    handlers.GET.mockResolvedValueOnce(answer);

    expect(await GET(get('/api/auth/callback/other?callbackUrl=%2Fbooked'))).toBe(answer);
  });

  it('adds the callbackUrl to a Verification redirect and keeps its cookies', async () => {
    const headers = new Headers({ Location: `${BASE}/auth/error?error=Verification` });
    headers.append('Set-Cookie', 'a=1; Path=/');
    headers.append('Set-Cookie', 'b=2; Path=/');
    handlers.GET.mockResolvedValueOnce(new Response(null, { status: 302, headers }));

    const res = await GET(get('/api/auth/callback/nodemailer?token=t&callbackUrl=%2Fbooked'));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      `${BASE}/auth/error?error=Verification&callbackUrl=%2Fbooked`
    );
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });
});
