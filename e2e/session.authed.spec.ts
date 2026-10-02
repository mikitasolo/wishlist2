import { test, expect } from './fixtures';

// Signed-in smoke tests (session cookie from global-setup). If the seeded
// session weren't accepted, the auth-gated pages would redirect home and these
// would fail — so they double as a check that the session injection works.

test('notifications page loads for a signed-in user (no redirect)', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('header shows the notification bell when signed in', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page.getByRole('link', { name: /Notifications/i })).toBeVisible();
});

test('my wishlists lists the seeded wishlist', async ({ page }) => {
  await page.goto('/wishlists/mine');
  await expect(page.getByText('E2E Birthday List')).toBeVisible();
});

// regression: /api/invite, left over from the deleted admin panel, answered any
// signed-in user — GET listed every user's email, PATCH signed any user out,
// POST emailed arbitrary addresses. It must 404 on every method it had.
test('regression: the legacy /api/invite endpoint 404s for a signed-in user', async ({ page }) => {
  for (const method of ['GET', 'POST', 'PATCH']) {
    const res = await page.request.fetch('/api/invite', {
      method,
      data: method === 'GET' ? undefined : {},
    });
    expect(res.status(), `${method} /api/invite`).toBe(404);
  }
});

// regression: the session callback returned Auth.js's `{ ...sessionRow, user }`
// as is, so this endpoint handed any script on the page the raw session token
// that the httpOnly cookie keeps from it, plus the user's whole row.
test('regression: the session endpoint has the user’s id and username, never the session token', async ({
  page,
}) => {
  const res = await page.request.get('/api/auth/session');
  expect(res.status()).toBe(200);
  const text = await res.text();
  const body = JSON.parse(text);

  expect(body.user.id).toMatch(/^[a-f0-9]{24}$/);
  expect(body.user.username).toBe('e2euser');
  expect(text).not.toContain('sessionToken');
  expect(body).not.toHaveProperty('userId');
  const token = (await page.context().cookies()).find(
    (c) => c.name === 'authjs.session-token'
  )?.value;
  expect(token).toBeTruthy();
  expect(text).not.toContain(token!);
});
