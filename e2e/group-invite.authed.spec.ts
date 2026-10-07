import { test, expect } from './fixtures';

// Inviting a group (WIS-37): on a list's People tab, Invite → Group sends each
// person in one of your groups their own invite, and says who was invited.
// The group is made through the API with the third seeded user (`e2ehost`),
// whom no other spec signs in as, and everything is put back afterwards: the
// invite, the group and the follow, since the seeded user is shared.

test('invite a whole group from the People tab', async ({ page }) => {
  const host = (await (await page.request.get('/api/users/by-username/e2ehost')).json()).data;
  expect((await page.request.post(`/api/users/${host._id}/follow`)).ok()).toBe(true);
  const group = (
    await (await page.request.post('/api/users/me/groups', { data: { name: 'E2E hosts' } })).json()
  ).data;
  try {
    expect(
      (
        await page.request.post(`/api/users/me/groups/${group.id}/members`, {
          data: { userId: host._id },
        })
      ).ok()
    ).toBe(true);

    await page.goto('/wishlists/e2e-birthday?tab=people');
    await page.getByRole('radio', { name: 'Group' }).click();
    await page.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: 'E2E hosts · 1 person' }).click();
    await page.getByRole('button', { name: 'Invite group' }).click();

    const result = page.getByRole('status').filter({ hasText: 'Invited 1 person.' });
    await expect(result).toContainText('@e2ehost');
    // The invite is an ordinary one, listed under Invited.
    const cancel = page.getByRole('button', { name: 'Cancel the invite to @e2ehost' });
    await expect(cancel).toBeVisible();

    // Again: they're skipped, in the single invite's words.
    await page.getByRole('button', { name: 'Invite group' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No one was invited.' })).toContainText(
      '@e2ehost: This person already has a pending invite'
    );

    await cancel.click();
    await expect(cancel).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/users/me/groups/${group.id}`);
    await page.request.delete(`/api/users/${host._id}/follow`);
  }
});
