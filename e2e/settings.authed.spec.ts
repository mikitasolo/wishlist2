import { test, expect } from './fixtures';

// Account settings (WIS-265): four panels, settings that save as they're
// changed, and the username and bio behind their own Save. Every change made
// here is put back, since the seeded user is shared by every spec.

test('a privacy setting saves as it is changed, and stays saved', async ({ page }) => {
  await page.goto('/settings');
  for (const name of ['Public profile', 'Privacy', 'Preferences', 'Account']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/\/users\/e2euser$/)).toBeVisible();

  const searchable = page.getByRole('switch', { name: 'Searchable' });
  await expect(searchable).toHaveAttribute('aria-checked', 'true');
  await searchable.click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await expect(searchable).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/won’t appear in search or invite suggestions/)).toBeVisible();

  await searchable.click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(searchable).toHaveAttribute('aria-checked', 'true');
});

test('the bio waits for its Save, and asks before leaving it unsaved', async ({ page }) => {
  await page.goto('/settings');
  const bio = page.getByRole('textbox', { name: 'Bio' });
  await expect(bio).toBeVisible();
  const original = await bio.inputValue();

  await bio.fill('Saved from the settings spec');
  // Leaving with the edit asks first, and Keep editing stays.
  await page.getByRole('banner').getByRole('link', { name: 'Home', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL('/settings');
  await expect(bio).toHaveValue('Saved from the settings spec');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(bio).toHaveValue('Saved from the settings spec');

  await bio.fill(original);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});
