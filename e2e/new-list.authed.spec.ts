import { test, expect } from './fixtures';

// A list made through the app, as a new owner makes their first one. It's
// deleted at the end, so the specs after this one see only the seeded lists.

// regression: the owner's default status filter never includes All, so every
// new list said "No items match the selected filters", under five zero stat
// cards and the toolbar, with no way to add an item there.
test('regression: a new list tells its owner it is empty, and Add your first item adds one', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New wishlist' }).click();
  const create = page.getByRole('dialog', { name: 'Create new wishlist' });
  await create.getByLabel('Wishlist name').fill('E2E New List');
  await create.getByRole('button', { name: 'Create wishlist' }).click();
  await page.waitForURL(/\/wishlists\/[^/?#]+$/);
  const list = new URL(page.url()).pathname;

  try {
    await expect(page.getByRole('heading', { level: 1, name: 'E2E New List' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
    await expect(page.getByText('No items match the selected filters.')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Search items by name' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filter by status' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add your first item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add new item' });
    await dialog.getByLabel('Item name').fill('E2E First Item');
    await dialog.getByRole('button', { name: 'Add item', exact: true }).click();

    await expect(page.getByRole('article', { name: 'Item: E2E First Item' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filter by status' })).toBeVisible();
  } finally {
    await page.request.delete(`/api${list}`);
  }
});
