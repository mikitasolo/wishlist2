import { test, expect } from './fixtures';

// A list made through the app, as a new owner makes their first one. It's
// deleted at the end, so the specs after this one see only the seeded lists.

// regression: the owner's default status filter never includes All, so every
// new list said "No items match the selected filters", under five zero stat
// cards and the toolbar, with no way to add an item there.
test('regression: a new list tells its owner it is empty, Add your first item adds one, and Keep adding adds more', async ({
  page,
}) => {
  await page.goto('/');
  // Home's New list, in its greeting row (the header has none since WIS-302).
  await page.locator('main header').getByRole('button', { name: 'New list' }).click();
  const create = page.getByRole('dialog', { name: 'Create new wishlist' });
  await create.getByLabel('Wishlist name').fill('E2E New List');
  await create.getByRole('button', { name: 'Create wishlist' }).click();
  await page.waitForURL(/\/wishlists\/[^/?#]+$/);
  const list = new URL(page.url()).pathname;

  try {
    await expect(page.getByRole('heading', { level: 1, name: 'E2E New List' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No items found' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Search items by name' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Show items' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add your first item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add new item' });
    await dialog.getByLabel('Item name').fill('E2E First Item');
    await dialog.getByRole('button', { name: 'Add item', exact: true }).click();

    await expect(page.getByRole('article', { name: 'Item: E2E First Item' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'All 1' })).toBeChecked();

    // With an item on it the grid starts with the Add item tile, and Keep
    // adding saves item after item without leaving the dialog (WIS-242).
    const grid = page.getByRole('article', { name: 'Item: E2E First Item' }).locator('..');
    const tile = grid.locator('> button', { hasText: 'Add item' });
    await expect(grid.locator('> *').first()).toHaveText('Add item');
    await tile.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Keep adding' }).check();
    for (const name of ['E2E Second Item', 'E2E Third Item']) {
      await dialog.getByLabel('Item name').fill(name);
      await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
      await expect(page.getByRole('article', { name: `Item: ${name}` })).toBeVisible();
      // Cleared, still open, and ready for the next one.
      await expect(dialog.getByLabel('Item name')).toHaveValue('');
      await expect(dialog.getByLabel('Item name')).toBeFocused();
    }
    await expect(page.getByRole('status').getByText('Item added successfully')).not.toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'All 3' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await page.request.delete(`/api${list}`);
  }
});
