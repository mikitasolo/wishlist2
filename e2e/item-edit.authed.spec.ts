import { test, expect, failedRequest } from './fixtures';

// regression: the page closed the edit modal whatever the outcome, because
// handleUpdateItem toasts a failure and resolves, so a failed save threw away
// the user's changes. The PATCH is failed in the browser, so nothing reaches the
// seeded database.
test('regression: the owner\'s "Edit item" modal keeps the changes when saving fails', async ({
  page,
  consoleErrors,
}) => {
  // The failed PATCH, and the app's log lines for it.
  consoleErrors.allow(
    failedRequest(/\/api\/items\/\w+/),
    /^Error updating item: /,
    /^Error submitting form: /
  );
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

  const dialog = page.getByRole('dialog', { name: 'Edit item' });
  await dialog.getByLabel('Item name').fill('E2E Bike');
  // Either decimal separator, whatever the locale (this browser's is en-US).
  await dialog.getByLabel('Price').fill('349,00');
  const patched = page.waitForRequest(
    (req) => req.method() === 'PATCH' && /\/api\/items\/\w+$/.test(req.url())
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  expect((await patched).postDataJSON()).toMatchObject({
    name: 'E2E Bike',
    price: { value: 34900 },
  });

  await expect(page.getByRole('status').getByText('Something went wrong')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Item name')).toHaveValue('E2E Bike');
  // Leaving the field put the amount in the cards' format.
  await expect(dialog.getByLabel('Price')).toHaveValue('349.00');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();

  // The optimistic edit is rolled back: the list shows the server's item while
  // the modal still holds the draft.
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Item: E2E Bike' })).toHaveCount(0);
});
