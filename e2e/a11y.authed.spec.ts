import { test, expect } from './fixtures';
import { seriousViolations } from './axe';

// An axe scan of the signed-in screens, light and dark, failing on serious or
// critical violations (WIS-383). Exceptions live in `ALLOWED_A11Y_VIOLATIONS`.
// Nothing here changes data.

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    });

    test('the dashboard, Reserved, Activity and Settings have no serious violations', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByText('E2E Birthday List').first()).toBeVisible();
      expect(await seriousViolations(page, `dashboard (${theme})`)).toEqual([]);

      await page.goto('/booked');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await seriousViolations(page, `Reserved (${theme})`)).toEqual([]);

      await page.goto('/notifications');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await seriousViolations(page, `Activity (${theme})`)).toEqual([]);

      await page.goto('/settings');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await seriousViolations(page, `Settings (${theme})`)).toEqual([]);
    });

    test('a list as owner and as member, the item sheet and the edit dialog, have no serious violations', async ({
      page,
    }) => {
      await page.goto('/wishlists/e2e-birthday');
      const card = page.getByRole('article', { name: 'Item: E2E Gift' });
      await expect(card).toBeVisible();
      expect(await seriousViolations(page, `list as owner (${theme})`)).toEqual([]);

      await card.getByRole('button', { name: 'E2E Gift' }).click();
      await expect(page.getByRole('dialog', { name: 'E2E Gift' })).toBeVisible();
      expect(await seriousViolations(page, `item sheet (${theme})`)).toEqual([]);

      await page.keyboard.press('Escape');
      await card.getByRole('button', { name: 'Edit item' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit item' })).toBeVisible();
      expect(await seriousViolations(page, `item dialog (${theme})`)).toEqual([]);

      await page.goto('/wishlists/e2e-friend');
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Friend List' })).toBeVisible();
      expect(await seriousViolations(page, `list as member (${theme})`)).toEqual([]);
    });
  });
}
