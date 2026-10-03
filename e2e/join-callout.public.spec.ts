import { test, expect } from './fixtures';

// Signed out, a shared list says who can reserve its items and how to get
// invited, and Sign in comes back to the list.

const LIST = '/wishlists/e2e-birthday';

test('a signed-out visitor is told how to get invited, and Sign in comes back to the list', async ({
  page,
}) => {
  await page.goto(LIST);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Birthday List' })).toBeVisible();

  const note = page.getByRole('note').filter({ hasText: 'Want to reserve a gift?' });
  await expect(note).toContainText(
    'Only people @e2euser invites can reserve items, so nobody buys the same thing twice.'
  );

  // The note's own Sign in, not the header's.
  await note.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  const callbackUrl = new URL(page.url()).searchParams.get('callbackUrl');
  expect(callbackUrl && new URL(callbackUrl, page.url()).pathname).toBe(LIST);
});
