import { test, expect } from './fixtures';

// Groups (WIS-27): tag someone you follow into a group from their profile, see
// it in Settings → Groups, and unfollowing takes them out. Everything made here
// is put back (the follow, the group), since the seeded user is shared by every
// spec.

test('tag someone you follow into a new group, and unfollowing takes them out', async ({
  page,
}) => {
  await page.goto('/users/e2efriend');
  // Only people you follow can be tagged.
  await expect(page.getByRole('button', { name: 'Follow @e2efriend' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tag @e2efriend into groups' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Follow @e2efriend' }).click();

  await page.getByRole('button', { name: 'Tag @e2efriend into groups' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tag @e2efriend into groups' });
  await dialog.getByLabel('New group').fill('E2E family');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'E2E family' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.goto('/settings#groups');
  const group = page.getByRole('region', { name: 'E2E family' });
  await expect(group.getByRole('link', { name: '@e2efriend' })).toBeVisible();

  // Unfollowing (one tap: they don't follow back) takes them out of the group.
  await page.goto('/users/e2efriend');
  await page.getByRole('button', { name: 'Unfollow @e2efriend' }).click();
  await expect(page.getByRole('button', { name: 'Follow @e2efriend' })).toBeVisible();
  await page.goto('/settings#groups');
  await expect(group.getByText('0 people')).toBeVisible();
  await expect(group.getByRole('link', { name: '@e2efriend' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Actions for E2E family' }).click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await page
    .getByRole('alertdialog', { name: 'Delete E2E family?' })
    .getByRole('button', { name: 'Delete group' })
    .click();
  await expect(page.getByRole('region', { name: 'E2E family' })).toHaveCount(0);
});
