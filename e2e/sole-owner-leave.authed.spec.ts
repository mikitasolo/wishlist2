import { test, expect } from './fixtures';

// The seeded user is the only owner of e2e-birthday. Nothing here writes: the
// explanation leaves nothing, and no invite is sent. A phone-sized window, so
// the invite form is off screen once the page is scrolled down to the Leave.
test.use({ viewport: { width: 390, height: 640 } });

test("the sole owner's Leave explains, and takes them to an owner invite", async ({ page }) => {
  const leaves: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().endsWith('/members/me')) {
      leaves.push(request.url());
    }
  });

  await page.goto('/wishlists/e2e-birthday');
  await page.getByRole('button', { name: 'Manage wishlist' }).click();
  // Only on their own owner row: the header has none for a sole owner.
  const leave = page.getByRole('button', { name: 'Leave', exact: true });
  await expect(leave).toHaveCount(1);
  const field = page.getByPlaceholder('Search by username');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await leave.click();

  const dialog = page.getByRole('alertdialog', { name: "You're the only owner" });
  await expect(dialog).toContainText(/invite a co-owner/);
  await expect(field).not.toBeInViewport();
  await dialog.getByRole('button', { name: 'Invite a co-owner' }).click();

  await expect(dialog).toBeHidden();
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Role' })).toHaveText(/Owner/);
  expect(leaves).toEqual([]);
});
