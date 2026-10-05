import { test, expect, failedRequest } from './fixtures';
import { E2E_REVOKED_LINK_TOKEN, E2E_VIEW_LINK_TOKEN } from './shareLinks';

// Signed out: a share link opens an Invite only list (WIS-335), and a dead one
// says so, with no way in.

test('a View link opens an Invite only list for a signed-out visitor', async ({
  page,
  consoleErrors,
}) => {
  // The list's own URL is refused on purpose first: the browser logs both reads.
  consoleErrors.allow(failedRequest(/\/api\/wishlists\/e2e-hidden(\/items)?/));
  await page.goto('/wishlists/e2e-hidden');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This wishlist isn’t available' })
  ).toBeVisible();

  await page.goto(`/l/${E2E_VIEW_LINK_TOKEN}`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Hidden List' })).toBeVisible();
  await expect(page.getByText('E2E Hidden Gift')).toBeVisible();
  await expect(page.getByText('Keep this link to come back to the list.')).toBeVisible();
  await expect(page).toHaveURL(`/l/${E2E_VIEW_LINK_TOKEN}`);

  // Sign in comes back to the link, to ask to join.
  await page.getByRole('main').getByRole('button', { name: 'Sign in to ask to join' }).click();
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  const callbackUrl = new URL(page.url()).searchParams.get('callbackUrl');
  const back = callbackUrl ? new URL(callbackUrl, page.url()) : null;
  expect(back?.pathname).toBe(`/l/${E2E_VIEW_LINK_TOKEN}`);
  expect(back?.search).toBe('?then=ask');
});

test('a revoked link shows the dead-link state, with no Sign in', async ({ page }) => {
  await page.goto(`/l/${E2E_REVOKED_LINK_TOKEN}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'This link doesn’t work anymore' })
  ).toBeVisible();
  await expect(page.getByText('Ask the person who sent it for a new one.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /Sign in/ })).toHaveCount(0);
});
