import { test, expect, failedRequest } from './fixtures';

// Signed out: a list that can't be opened, and a URL no route matches, each
// get a page of their own at the URL that was asked for.

const MISSING_LIST = '/wishlists/e2e-no-such-list';

// regression: a list that couldn't be opened sent the visitor home with two
// error toasts, losing the URL, and never offered a signed-out visitor the
// sign-in that might have let them in.
test('regression: a missing list says so in place, and Sign in comes back to it', async ({
  page,
  consoleErrors,
}) => {
  // The list and its items are refused on purpose: the browser logs both.
  consoleErrors.allow(failedRequest(/\/api\/wishlists\/e2e-no-such-list(\/items)?/));

  await page.goto(`${MISSING_LIST}?from=chat`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'This wishlist isn’t available' })
  ).toBeVisible();
  await expect(page.getByText('If someone shared it with you, sign in to see it.')).toBeVisible();
  await expect(page).toHaveURL(`${MISSING_LIST}?from=chat`);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');

  // The page's own Sign in, not the header's.
  await page.getByRole('main').getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  const callbackUrl = new URL(page.url()).searchParams.get('callbackUrl');
  expect(callbackUrl && new URL(callbackUrl, page.url()).pathname).toBe(MISSING_LIST);
  expect(callbackUrl && new URL(callbackUrl, page.url()).search).toBe('?from=chat');
});

test('a URL no route matches gets the branded not-found page', async ({ page, consoleErrors }) => {
  // The page itself is answered 404, which the browser logs.
  consoleErrors.allow(failedRequest(/\/e2e-no-such-page/));

  const response = await page.goto('/e2e-no-such-page');
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { level: 1, name: 'This page doesn’t exist' })
  ).toBeVisible();
  // The app's own header and search, and a way home.
  await expect(page.getByRole('link', { name: 'Wishlist home' })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('textbox', { name: 'Search people and wishlists' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
});
