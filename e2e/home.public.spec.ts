import { test, expect } from './fixtures';

// Signed-out smoke tests (no session cookie).

test('home page loads with the brand title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Wishlist/);
});

// regression: `/` was a client component that rendered the landing only once
// the browser had read the session, so the server sent every visitor and
// crawler the header and a spinner (WIS-269).
test('regression: the server HTML for / is the landing itself, with no spinner', async ({
  request,
}) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('Wishlists your friends can shop from');
  expect(html).toContain('Create your wishlist');
  expect(html).toContain('Looking for someone’s list? Search by username');
  expect(html).not.toContain('animate-spin');
  expect(html).not.toMatch(/class="[^"]*\bskeleton\b/);
});

test('the landing’s one call to action opens sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: 'Create your wishlist' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
});

test('sign-in page shows the magic-link email field', async ({ page }) => {
  await page.goto('/auth/signin');
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

// Through the sign-in form's server action, with Turnstile off (no keys in
// E2E). The console transport prints the link to the server log; nothing is sent.
test('the sign-in form sends a magic link', async ({ page }) => {
  await page.goto('/auth/signin?callbackUrl=%2Finvites');
  await page.getByLabel('Email address').fill('e2e-signin@example.com');
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('Sent to e2e-signin@example.com')).toBeVisible();
  // Held back for 30 seconds after a send.
  await expect(page.getByRole('button', { name: /^Resend link in \d+s$/ })).toBeDisabled();

  // A typo needn't mean reloading the page: back to the form, address kept.
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page.getByLabel('Email address')).toHaveValue('e2e-signin@example.com');
});

test('the sign-in form checks the email inline', async ({ page }) => {
  await page.goto('/auth/signin');
  const email = page.getByLabel('Email address');
  await email.fill('not-an-email');
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter an email address like you@example.com')).toBeVisible();
});

test('sign-in from a list says where it continues to, without naming the list', async ({
  page,
}) => {
  await page.goto('/auth/signin?callbackUrl=%2Fwishlists%2Fe2e-friend');
  await expect(
    page.getByText("We'll email you a link to continue to the wishlist you opened — no password.")
  ).toBeVisible();
  await expect(page.getByText(/E2E Friend/i)).toHaveCount(0);
});

// regression: Try again on the error page dropped the callbackUrl, so an
// expired link from a shared list ended on the dashboard.
test('regression: the auth error page keeps where sign-in was going', async ({ page }) => {
  await page.goto('/auth/error?error=Verification&callbackUrl=%2Fwishlists%2Fe2e-friend');
  await expect(page.getByRole('heading', { name: 'That sign-in link has expired' })).toBeVisible();
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page).toHaveURL('/auth/signin?callbackUrl=%2Fwishlists%2Fe2e-friend');
  await expect(
    page.getByText("We'll email you a link to continue to the wishlist you opened — no password.")
  ).toBeVisible();
});

// regression: the pages that need an account sent a signed-out visitor home,
// losing where they were going.
// /invites is Activity now (WIS-250), so it continues there once signed in.
for (const [path, back] of [
  ['/notifications', '/notifications'],
  ['/invites', '/notifications'],
]) {
  test(`regression: ${path} sends a signed-out visitor to sign in, then back to ${back}`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page).toHaveURL(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`);
    await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
  });
}

test('the landing search finds a public list and a person', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search people and wishlists' });
  await search.fill('e2e friend');
  await expect(page.getByRole('option', { name: 'E2E Friend List' })).toBeVisible();

  // A handle as it's shown and shared, @ included.
  await search.fill('@e2efriend');
  await page.getByRole('option', { name: '@e2efriend', exact: true }).click();
  await expect(page).toHaveURL('/users/e2efriend');
});
