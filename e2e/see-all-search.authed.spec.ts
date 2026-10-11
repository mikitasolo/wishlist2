import { test, expect } from './fixtures';

// WIS-427: the See all pages filter their lists by name, in the URL's ?q=.

test('Your wishlists filters by name and keeps the query in the URL', async ({ page }) => {
  await page.goto('/wishlists/mine');
  const search = page.getByRole('textbox', { name: 'Search your wishlists' });
  await expect(page.getByText('E2E Birthday List').first()).toBeVisible();
  await search.fill('zzz-nothing');
  await expect(page.getByText('No wishlists match your search.')).toBeVisible();
  await expect(page).toHaveURL(/[?&]q=zzz-nothing/);
  await search.fill('birthday');
  await expect(page.getByText('E2E Birthday List').first()).toBeVisible();
  await page.reload();
  await expect(search).toHaveValue('birthday');
});

test('Shared with you filters by name from a ?q= link', async ({ page }) => {
  await page.goto('/wishlists/shared?q=friend');
  await expect(page.getByText('E2E Friend List').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Search shared wishlists' }).fill('zzz-nothing');
  await expect(page.getByText('No wishlists match your search.')).toBeVisible();
});
