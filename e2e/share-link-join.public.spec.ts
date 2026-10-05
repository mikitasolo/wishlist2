import { test, expect } from './fixtures';
import { E2E_JOIN_LINK_TOKEN } from './shareLinks';
import { MAGIC_LINKS, magicLinkPath } from './magicLinks';

// WIS-337: the friend opens a Join link signed out, signs in through it, is
// asked to confirm (nothing joins on load), joins, lands on the list with the
// welcome note, and can reserve a gift.

test('the friend joins through a Join link and reserves a gift', async ({ page }) => {
  const linkPath = `/l/${E2E_JOIN_LINK_TOKEN}`;
  await page.goto(linkPath);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Joinable List' })).toBeVisible();
  await expect(
    page.getByText('Join the list so nobody buys the same thing twice.', { exact: false })
  ).toBeVisible();

  // Sign in comes back to the link, to join.
  await page.getByRole('main').getByRole('button', { name: 'Sign in to join' }).click();
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  const callbackUrl = new URL(page.url()).searchParams.get('callbackUrl');
  const back = callbackUrl ? new URL(callbackUrl, page.url()) : null;
  expect(back?.pathname).toBe(linkPath);
  expect(back?.search).toBe('?then=join');

  // The email's link, as Auth.js would send it, back to the same place.
  await page.goto(magicLinkPath(MAGIC_LINKS.friendJoins, `${back!.pathname}${back!.search}`));

  // The confirmation is open at once, `then` is gone, and nothing has joined yet.
  const dialog = page.getByRole('alertdialog', { name: 'Join @e2ehost’s list?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'You’ll be able to reserve gifts. @e2ehost won’t see what you reserve.'
  );
  await expect(page).toHaveURL(linkPath);

  await dialog.getByRole('button', { name: 'Join', exact: true }).click();

  // On the list's own URL, as a member, with the welcome note.
  await expect(page).toHaveURL('/wishlists/e2e-joinable');
  await expect(page.getByText(/^You.re in\. Reserve a gift/)).toBeVisible();

  const card = page.getByRole('article', { name: 'Item: E2E Joinable Gift' });
  await card.getByRole('button', { name: 'Reserve this item', exact: true }).click();
  await expect(card.getByText('Reserved by you')).toBeVisible();
});
