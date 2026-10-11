import { test, expect } from './fixtures';
import { seriousViolations } from './axe';
import { E2E_VIEW_LINK_TOKEN } from './shareLinks';

// An axe scan of the signed-out screens, light and dark, failing on serious or
// critical violations (WIS-383). Exceptions live in `ALLOWED_A11Y_VIOLATIONS`.

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    });

    test('home, sign-in and a share link have no serious violations', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await seriousViolations(page, `home (${theme})`)).toEqual([]);

      await page.goto('/auth/signin');
      await expect(page.getByLabel('Email address')).toBeVisible();
      expect(await seriousViolations(page, `sign-in (${theme})`)).toEqual([]);

      await page.goto(`/l/${E2E_VIEW_LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Hidden List' })).toBeVisible();
      await expect(page.getByText('E2E Hidden Gift')).toBeVisible();
      expect(await seriousViolations(page, `share link (${theme})`)).toEqual([]);
    });
  });
}
