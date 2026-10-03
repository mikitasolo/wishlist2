import { test, expect, failedRequest } from './fixtures';
import type { ApiItem } from '../types/api';

// The seeded owner list has no proposals, so one is added to the items GET in
// the browser, and its PATCH is answered there too: nothing reaches the database.
const proposal: ApiItem = {
  _id: '000000000000000000000060',
  wishlist: '000000000000000000000001',
  name: 'E2E Proposed Lamp',
  status: 'proposed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const RATE_LIMITED = 'Too many requests. Please slow down.';

// regression: handleReviewItem toasted "Item approved successfully" and closed
// the review modal whatever the PATCH returned, and left the optimistic approve
// in the list, so the owner believed a proposal was published when it wasn't.
test('regression: a failed approve shows the error and leaves the item proposed', async ({
  page,
  consoleErrors,
}) => {
  // The rate-limited approve, and the app's log lines for it.
  consoleErrors.allow(
    failedRequest(new RegExp(`/api/items/${proposal._id}`)),
    /^Error updating item: /,
    /^Error submitting form: /
  );
  let listServed = false;
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    // Hold every refetch after the first load (the poll, and the reconcile after
    // a failure), so the list can only change locally: the page itself must put
    // the proposal back.
    if (listServed) return;
    const response = await route.fetch();
    const body = await response.json();
    listServed = true;
    await route.fulfill({ response, json: { ...body, data: [proposal, ...body.data] } });
  });

  let approveAttempts = 0;
  await page.route(`**/api/items/${proposal._id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    approveAttempts += 1;
    if (approveAttempts === 1) {
      return route.fulfill({ status: 429, json: { success: false, error: RATE_LIMITED } });
    }
    const updates = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { ...proposal, ...updates } } });
  });

  await page.goto('/wishlists/e2e-birthday');
  const proposedCard = page.getByRole('article', { name: `Item: ${proposal.name}` });
  await proposedCard.getByRole('button', { name: 'Review proposed item' }).click();

  const dialog = page.getByRole('dialog', { name: 'Review proposed item' });
  await dialog.getByLabel('Item name').fill('E2E Desk Lamp');
  await dialog.getByRole('button', { name: 'Approve item' }).click();

  // The API's error, not a success, and the modal keeps the owner's edits.
  await expect(page.getByRole('status').getByText(RATE_LIMITED)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve item' })).toBeEnabled();
  await expect(page.getByText('Item approved successfully')).toHaveCount(0);
  await expect(dialog.getByLabel('Item name')).toHaveValue('E2E Desk Lamp');

  // The optimistic approve was rolled back: the card is the proposal again.
  await expect(proposedCard.getByText('Proposed', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Item: E2E Desk Lamp' })).toHaveCount(0);

  // A retry that succeeds approves it and closes the modal.
  await dialog.getByRole('button', { name: 'Approve item' }).click();
  await expect(page.getByRole('status').getByText('Item approved successfully')).toBeVisible();
  await expect(dialog).toBeHidden();
  const approvedCard = page.getByRole('article', { name: 'Item: E2E Desk Lamp' });
  await expect(approvedCard).toBeVisible();
  await expect(approvedCard.getByText('Proposed', { exact: true })).toHaveCount(0);
  expect(approveAttempts).toBe(2);
});
