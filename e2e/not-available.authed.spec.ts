import { test, expect, failedRequest } from './fixtures';

// regression: a list that couldn't be opened sent the signed-in visitor home
// with two error toasts, losing the URL.
test('regression: a missing list says so in place to a signed-in visitor', async ({
  page,
  consoleErrors,
}) => {
  // The list and its items are refused on purpose: the browser logs both.
  consoleErrors.allow(failedRequest(/\/api\/wishlists\/e2e-no-such-list(\/items)?/));

  await page.goto('/wishlists/e2e-no-such-list');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This wishlist isn’t available to you' })
  ).toBeVisible();
  await expect(page).toHaveURL('/wishlists/e2e-no-such-list');
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to your wishlists' }).click();
  await expect(page).toHaveURL('/');
});
