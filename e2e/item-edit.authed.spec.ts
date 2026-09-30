import { test, expect } from '@playwright/test';

// regression: the page closed the edit modal whatever the outcome, because
// handleUpdateItem toasts a failure and resolves, so a failed save threw away
// the user's changes. The PATCH is failed in the browser, so nothing reaches the
// seeded database.
test('regression: the owner\'s "Edit Item" modal keeps the changes when saving fails', async ({
  page,
}) => {
  await page.route('**/api/items/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } })
      : route.continue()
  );
  await page.goto('/wishlists/e2e-birthday');
  await page
    .getByRole('article', { name: 'Item: E2E Gift' })
    .getByRole('button', { name: 'Edit item' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Edit Item' });
  await dialog.getByLabel('Item Name').fill('E2E Bike');
  await dialog.getByLabel('Price').fill('120');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page.getByRole('status').getByText('Something went wrong')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Item Name')).toHaveValue('E2E Bike');
  await expect(dialog.getByLabel('Price')).toHaveValue('120');
  await expect(dialog.getByRole('button', { name: 'Save Changes' })).toBeEnabled();

  // The optimistic edit is rolled back: the list shows the server's item while
  // the modal still holds the draft.
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Item: E2E Bike' })).toHaveCount(0);
});
