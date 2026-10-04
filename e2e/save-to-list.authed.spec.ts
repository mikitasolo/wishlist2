import { test, expect } from './fixtures';
import type { ApiItem } from '../types/api';

// "Save to my list" from a friend's list into one of your own. The friend's
// list has no seeded items, so one is added to its items GET in the browser,
// and the copy's POST is answered there too: nothing reaches the database.
const friendsItem: ApiItem = {
  _id: '000000000000000000000070',
  wishlist: '000000000000000000000071',
  name: 'E2E Desk Lamp',
  price: { value: 4500, currency: 'usd' },
  link: 'https://shop.example.com/lamp',
  notes: "The friend's own hint",
  status: 'available',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('a member saves a copy of a friend’s item to their own list', async ({ page }) => {
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        json: { success: true, data: { ...friendsItem, _id: '000000000000000000000072' } },
      });
    }
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({ response, json: { ...body, data: [friendsItem, ...body.data] } });
  });

  await page.goto('/wishlists/e2e-friend');
  // A member's card offers it in its "More actions" menu (Book is the primary).
  const card = page.getByRole('article', { name: `Item: ${friendsItem.name}` });
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('menu').getByRole('menuitem', { name: 'Save to my list' }).click();

  // The picker offers the list the E2E user owns.
  await page
    .getByRole('dialog', { name: 'Save to my list' })
    .getByRole('button', { name: /E2E Birthday List/ })
    .click();

  const form = page.getByRole('dialog', { name: 'Save to E2E Birthday List' });
  await expect(form.getByLabel('Item name')).toHaveValue(friendsItem.name);
  await expect(form.getByLabel('Price')).toHaveValue('45.00');
  await expect(form.getByLabel('Notes')).toHaveValue('');

  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && /\/api\/wishlists\/[^/]+\/items$/.test(req.url())
  );
  await form.getByRole('button', { name: 'Add to list', exact: true }).click();

  const request = await posted;
  expect(request.postDataJSON()).toMatchObject({
    name: friendsItem.name,
    sourceItemId: friendsItem._id,
  });
  expect(request.url()).not.toContain('e2e-friend');
  await expect(page.getByRole('status').getByText('Saved to E2E Birthday List')).toBeVisible();
  await expect(form).toHaveCount(0);
});
