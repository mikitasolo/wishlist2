import { test, expect } from './fixtures';
import { FRIEND_SESSION_TOKEN, MAGIC_LINKS, magicLinkPath } from './magicLinks';

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
  // The invite email's sign-in continues to /invites, which opens Activity.
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

  await keep.click();
  await expect(page).toHaveURL('/notifications');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
});

test('a new account can pick its own username on the welcome page', async ({ page }) => {
  await page.goto(magicLinkPath(MAGIC_LINKS.newcomerPicks, '/settings'));
  await expect(
    page.getByRole('heading', { name: 'Welcome to Wishlist', exact: true })
  ).toBeVisible();

  await page.getByLabel('Username', { exact: true }).fill('e2e_newcomer');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save username' }).click();

  // Back on course, with the new name saved.
  await expect(page).toHaveURL('/settings');
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('e2e_newcomer');
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
