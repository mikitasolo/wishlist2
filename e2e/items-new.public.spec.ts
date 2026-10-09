import { test, expect } from './fixtures';

// WIS-365: a signed-out visitor following the bookmarklet's link signs in
// first, and the product in the fragment goes along in the callback.
test('sends a signed-out visitor to sign in, keeping the fragment', async ({ page }) => {
  await page.goto('/items/new#name=Mug&link=https%3A%2F%2Fshop.example.com%2Fp');
  await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=/);
  const callback = new URL(page.url()).searchParams.get('callbackUrl');
  expect(callback).toBe('/items/new#name=Mug&link=https%3A%2F%2Fshop.example.com%2Fp');
});
