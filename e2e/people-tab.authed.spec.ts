import { test, expect } from './fixtures';

// The seeded user owns e2e-birthday and has no one on it. They invite the
// seeded friend and cancel the invite again, so the list ends as it began.
test('an owner opens People by its URL, invites someone and cancels the invite', async ({
  page,
}) => {
  await page.goto('/wishlists/e2e-birthday?tab=people');

  const people = page.getByRole('tab', { name: /^People/ });
  await expect(people).toHaveAttribute('aria-selected', 'true');
  // The sole owner: their own row, and no members yet.
  const panel = page.getByRole('region', { name: 'People on this list' });
  await expect(panel.getByRole('link', { name: '@e2euser' })).toBeVisible();
  await expect(panel).toContainText('No members yet.');

  await page.getByRole('combobox', { name: 'Search by username' }).fill('e2efriend');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation sent' })).toBeVisible();

  // Invited, on a row of its own, with its Cancel.
  await expect(panel.getByRole('heading', { name: 'Invited' })).toBeVisible();
  await expect(panel).toContainText('Invited as member');
  // Gone at once, with Undo; the cancel itself goes once the Undo window ends
  // (WIS-387), and is waited for, so the reload below reads the list after it.
  const cancelled = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && /\/invites\//.test(r.url()),
    { timeout: 15_000 }
  );
  await page.getByRole('button', { name: 'Cancel the invite to @e2efriend' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Invitation cancelled' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Invited' })).toBeHidden();
  expect((await cancelled).ok()).toBe(true);

  // Still on People after a reload; back from Items returns to it.
  await page.reload();
  await expect(people).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('heading', { name: 'Invited' })).toBeHidden();
  await page.getByRole('tab', { name: 'Items' }).click();
  await expect(page).toHaveURL(/\/wishlists\/e2e-birthday$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tab=people$/);
  await expect(people).toHaveAttribute('aria-selected', 'true');
});
