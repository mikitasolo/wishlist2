import { test, expect } from './fixtures';

// The unsubscribe page (WIS-321), signed out: a link that doesn't verify says
// so and changes nothing, and the one-click endpoint takes no GET, so a mail
// scanner opening links can't unsubscribe anyone.

test('a broken unsubscribe link says so, and points to Settings', async ({ page }) => {
  await page.goto('/unsubscribe?u=64b7f0c2a1b2c3d4e5f60718&e=proposal&t=forged');
  await expect(
    page.getByRole('heading', { name: 'This unsubscribe link doesn’t work' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unsubscribe' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Notification settings' })).toBeVisible();
});

test('the one-click endpoint does nothing on a GET', async ({ request }) => {
  const res = await request.get('/api/unsubscribe?u=64b7f0c2a1b2c3d4e5f60718&e=proposal&t=x');
  expect(res.status()).toBe(405);
});
