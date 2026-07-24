import { test, expect } from '@playwright/test';

// Signed-out smoke tests (no session cookie).

test('home page loads with the brand title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Wishlist/);
});

test('sign-in page shows the magic-link email field', async ({ page }) => {
  await page.goto('/auth/signin');
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test('a protected page redirects a signed-out visitor home', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page).toHaveURL('/');
});
