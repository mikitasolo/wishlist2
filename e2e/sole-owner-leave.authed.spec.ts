import { test, expect } from './fixtures';

// The seeded user is the only owner of e2e-birthday. Nothing here writes: the
// explanation leaves nothing, and no invite is sent. A phone-sized window, so
// the invite form, on People, has to be opened and scrolled to.
test.use({ viewport: { width: 390, height: 640 } });

test("the sole owner's Leave list… explains, and takes them to an owner invite", async ({
  page,
}) => {
  const leaves: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().endsWith('/members/me')) {
      leaves.push(request.url());
    }
  });

  await page.goto('/wishlists/e2e-birthday');
  // Leave is in the title's ⋯ menu, never a button beside Share.
  await expect(page.getByRole('button', { name: /^Leave/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'More list actions' }).click();
  await page.getByRole('menuitem', { name: 'Leave list…' }).click();

  const dialog = page.getByRole('alertdialog', { name: "You're the only owner" });
  await expect(dialog).toContainText(/invite a co-owner/);
  await dialog.getByRole('button', { name: 'Invite a co-owner' }).click();

  await expect(dialog).toBeHidden();
  const field = page.getByPlaceholder('Search by username');
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();
  await expect(page.getByRole('radio', { name: 'Co-owner' })).toBeChecked();
  // People opened for the form, in the URL: its own row has no second Leave.
  await expect(page).toHaveURL(/\/wishlists\/e2e-birthday\?tab=people$/);
  await expect(page.getByRole('tab', { name: /^People/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^Leave/ })).toHaveCount(0);
  expect(leaves).toEqual([]);
});
