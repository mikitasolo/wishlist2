import { test, expect } from './fixtures';
import { FRIEND_SESSION_TOKEN, MAGIC_LINKS, magicLinkPath } from './magicLinks';
import { E2E_JOIN_LINK_TOKEN } from './shareLinks';

// Signing in by following a magic link (seeded by global-setup) through
// Auth.js's real callback: a new account's first sign-in is offered the
// welcome page, with the original destination carried through it.

// Every test here spends seeded state (each link works once, and one ends a
// seeded session), so a retry can't re-run one: it would only fail on the
// spent link. The first failure is the one to read.
test.describe.configure({ retries: 0 });

test('a new account is offered a username, and keeping the generated one continues on', async ({
  page,
}) => {
  // The invite email's sign-in carries /invites through Welcome.
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerKeeps, '/invites'));

  await expect(page).toHaveURL(/\/welcome\?callbackUrl=/);
  await expect(
    page.getByRole('heading', { name: 'Welcome to Wishlist', exact: true })
  ).toBeVisible();
  // The generated handle is random, nothing taken from the email.
  const keep = page.getByRole('button', { name: /^Keep @/ });
  await expect(keep).toHaveText(/^Keep @user_[a-z0-9]{8}$/);
  // The field starts empty: the generated handle is only on the Keep button.
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save username' })).toBeDisabled();
  // The minimal header: no navigation, no search.
  await expect(page.getByRole('link', { name: 'Reserved' })).toHaveCount(0);

  // A brand-new account hasn't done the guided walkthrough (WIS-371, WIS-436),
  // so it lands where the tour starts (Home) instead of the invite's
  // destination, and the tour's first step opens.
  await keep.click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('dialog', { name: 'Lists for every occasion' })).toBeVisible();
});

test('a new account can pick its own username on the welcome page', async ({ page }) => {
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerPicks, '/settings'));
  await expect(
    page.getByRole('heading', { name: 'Welcome to Wishlist', exact: true })
  ).toBeVisible();

  await page.getByLabel('Username', { exact: true }).fill('e2e_newcomer');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save username' }).click();

  // regression: a brand-new account hasn't done the guided walkthrough
  // (WIS-371, WIS-436), so once Welcome hands over, the tour sends it Home
  // (where it starts) at a moment that raced with this spec's /settings
  // assertions. What this test is about is the saved name, so check that
  // through the account itself, wherever the tour has taken the page.
  await expect
    .poll(async () => (await (await page.request.get('/api/users/me')).json()).data?.username)
    .toBe('e2e_newcomer');
});

test('an existing account signs straight in, without the welcome page', async ({ page }) => {
  await page.goto(magicLinkPath(MAGIC_LINKS.returning, '/invites'));

  await expect(page).toHaveURL('/notifications');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
});

// regression: WIS-82 moved account creation from the magic-link request to the
// first verified sign-in, so a sign-up takes Auth.js's new-user branch, which
// (unlike its existing-user branch) never ended the session the browser was
// signed in with: it stayed valid until it expired.
test('regression: signing up while signed in as someone else ends that session', async ({
  page,
  request,
}) => {
  const cookie = { name: 'authjs.session-token', value: FRIEND_SESSION_TOKEN };
  /** Whom the friend's session token signs in as now, if anyone. */
  const friendSession = async () =>
    (
      await request.get('/api/auth/session', {
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      })
    ).json();
  expect((await friendSession())?.user?.username).toBe('e2efriend');

  await page
    .context()
    .addCookies([{ ...cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerSwitches, '/invites'));

  // Signed in as the new account...
  await expect(
    page.getByRole('heading', { name: 'Welcome to Wishlist', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Keep @user_[a-z0-9]{8}$/ })).toBeVisible();
  // ...and the friend's session is over, not just dropped from this browser.
  expect(await friendSession()).toBeNull();
});

// WIS-339: a brand-new account signing up through a Join link is told the list
// is next, goes on in one click, and is back on the link with its confirmation.
test('a new account signing up through a Join link continues to it in one click', async ({
  page,
}) => {
  const linkPath = `/l/${E2E_JOIN_LINK_TOKEN}`;
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerJoins, `${linkPath}?then=join`));

  await expect(page).toHaveURL(/\/welcome\?callbackUrl=/);
  await expect(
    page.getByText('One quick thing before you join “E2E Joinable List”', { exact: false })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Continue as @user_[a-z0-9]{8}$/ }).click();

  // Back on the link, the confirmation open, nothing joined yet.
  const dialog = page.getByRole('alertdialog', { name: 'Join @e2ehost’s list?' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(linkPath);
  await dialog.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL('/wishlists/e2e-joinable');
  await expect(page.getByText(/^You.re in\. Reserve a gift/)).toBeVisible();
});
