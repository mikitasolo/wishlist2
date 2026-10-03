import { test, expect } from './fixtures';

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

// Through the sign-in form's server action, with Turnstile off (no keys in
// E2E). The console transport prints the link to the server log; nothing is sent.
test('the sign-in form sends a magic link', async ({ page }) => {
  await page.goto('/auth/signin?callbackUrl=%2Finvites');
  await page.getByLabel('Email address').fill('e2e-signin@example.com');
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await expect(page.getByText('e2e-signin@example.com')).toBeVisible();
});

// regression: the pages that need an account sent a signed-out visitor home,
// losing where they were going.
// /invites is Activity now (WIS-250), so it continues there once signed in.
for (const [path, back] of [
  ['/notifications', '/notifications'],
  ['/invites', '/notifications'],
]) {
  test(`regression: ${path} sends a signed-out visitor to sign in, then back to ${back}`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page).toHaveURL(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`);
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
}

test('the landing search finds a public list and a person', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Search people and wishlists' });
  await search.fill('e2e friend');
  await expect(page.getByRole('button', { name: /E2E Friend List/ })).toBeVisible();

  // A handle as it's shown and shared, @ included.
  await search.fill('@e2efriend');
  // Exact: the list row's name ends in its owner's "@e2efriend" too.
  await page.getByRole('button', { name: '@e2efriend', exact: true }).click();
  await expect(page).toHaveURL('/users/e2efriend');
});
