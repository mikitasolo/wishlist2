import { test, expect } from '@playwright/test';

// regression: WIS-156. Every /api/auth/* route and /api/upload answered 500
// on Vercel because their modules loaded sharp, whose native libvips was
// missing from the bundle. These check the routes start and answer, with GETs
// only: no sign-in email is sent and nothing is uploaded.
test('the auth endpoints answer, so magic links and sessions work', async ({ request }) => {
  const csrf = await request.get('/api/auth/csrf');
  expect(csrf.status()).toBe(200);
  expect(typeof (await csrf.json()).csrfToken).toBe('string');

  const providers = await request.get('/api/auth/providers');
  expect(providers.status()).toBe(200);
  expect(await providers.json()).toHaveProperty('nodemailer');

  expect((await request.get('/api/auth/session')).status()).toBe(200);
});

test('the upload route starts (it answers GET with 405, not a 500)', async ({ request }) => {
  expect((await request.get('/api/upload')).status()).toBe(405);
});

// A magic link is only sent by the sign-in form's server action, after its
// Turnstile check, so Auth.js's own sign-in POST is refused before it runs:
// nothing is sent, and no account is created.
test("Auth.js's own sign-in POST is refused", async ({ request }) => {
  const { csrfToken } = await (await request.get('/api/auth/csrf')).json();
  const res = await request.post('/api/auth/signin/nodemailer', {
    form: { email: 'e2e-bypass@example.com', csrfToken },
    headers: { 'X-Auth-Return-Redirect': '1' },
  });
  expect(res.status()).toBe(403);
});
