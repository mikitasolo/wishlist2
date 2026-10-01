import { test, expect } from '@playwright/test';
import { MAGIC_LINKS, magicLinkPath } from './magicLinks';

// Signing in by following a magic link (seeded by global-setup) through
// Auth.js's real callback: a new account's first sign-in is offered the
// welcome page, with the original destination carried through it.

test('a new account is offered a username, and keeping the generated one continues on', async ({
  page,
}) => {
  // The invite email's sign-in continues to /invites.
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerKeeps, '/invites'));

  await expect(page).toHaveURL(/\/welcome\?callbackUrl=/);
  await expect(page.getByRole('heading', { name: 'Welcome to Wishlist' })).toBeVisible();
  // The generated handle is random, nothing taken from the email.
  const keep = page.getByRole('button', { name: /^Keep @/ });
  await expect(keep).toHaveText(/^Keep @user_[a-z0-9]{8}$/);
  await expect(page.getByLabel('Username')).toHaveValue(/^user_[a-z0-9]{8}$/);

  await keep.click();
  await expect(page).toHaveURL('/invites');
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();
});

test('a new account can pick its own username on the welcome page', async ({ page }) => {
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerPicks, '/settings'));
  await expect(page.getByRole('heading', { name: 'Welcome to Wishlist' })).toBeVisible();

  await page.getByLabel('Username').fill('e2e_newcomer');
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: 'Save username' }).click();

  // Back on course, with the new name saved.
  await expect(page).toHaveURL('/settings');
  await expect(page.getByLabel('Username')).toHaveValue('e2e_newcomer');
});

test('an existing account signs straight in, without the welcome page', async ({ page }) => {
  await page.goto(magicLinkPath(MAGIC_LINKS.returning, '/invites'));

  await expect(page).toHaveURL('/invites');
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();
});
