import { test, expect } from '@playwright/test';

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
