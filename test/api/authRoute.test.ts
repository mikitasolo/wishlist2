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
  // Turnstile check. Auth.js's own sign-in POST would send one past it (and
  // create the account first), so it never reaches Auth.js.
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
  it("is Auth.js's handler, untouched", () => {
    expect(GET).toBe(handlers.GET);
  });
});
