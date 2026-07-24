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
