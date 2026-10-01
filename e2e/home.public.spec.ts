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

test('the landing search finds a public list and a person', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Search people and wishlists' });
  await search.fill('e2e friend');
  await expect(page.getByRole('button', { name: /E2E Friend List/ })).toBeVisible();

  await search.fill('e2efriend');
  // Exact: the list row's name ends in its owner's "@e2efriend" too.
  await page.getByRole('button', { name: '@e2efriend', exact: true }).click();
  await expect(page).toHaveURL('/users/e2efriend');
});
