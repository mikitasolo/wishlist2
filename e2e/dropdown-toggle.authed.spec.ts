import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// A popup's trigger clicked again closes it (WIS-315). Chromium focuses a
// clicked button; Safari and Firefox on macOS don't, so the mousedown's default
// action blurs whatever held focus (the trigger, or the open menu), and a popup
// that closes when focus leaves it closes before the click, which then opens
// it again. The `safari` mode reproduces that: unless a handler cancelled the
// mousedown, it takes focus off the focused element, as those browsers do.
// Nothing here picks an option, so nothing is saved.

test.use({ viewport: { width: 1280, height: 1600 } });

async function blurOnUncancelledMousedown(page: Page) {
  await page.addInitScript(() => {
    // On `window`, after React's own listener (on `document`) has had its say.
    window.addEventListener('mousedown', (e) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    });
  });
}

for (const mode of ['chromium', 'safari'] as const) {
  test.describe(`${mode} focus on click`, () => {
    test.beforeEach(async ({ page }) => {
      if (mode === 'safari') await blurOnUncancelledMousedown(page);
    });

    test('the account menu closes on a second click of its trigger', async ({ page }) => {
      await page.goto('/wishlists/e2e-birthday');
      const trigger = page.getByRole('button', { name: 'Account menu' });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    test("an item card's More actions menu closes on a second click", async ({ page }) => {
      await page.goto('/wishlists/e2e-birthday');
      const card = page.getByRole('article', { name: 'Item: E2E Gift' });
      const trigger = card.getByRole('button', { name: 'More actions' });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    });

    test("the owner's Share menu closes on a second click", async ({ page }) => {
      await page.goto('/wishlists/e2e-birthday');
      const trigger = page.getByRole('button', { name: 'Share', exact: true });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    test('a Select closes on a second click of its trigger', async ({ page }) => {
      await page.goto('/wishlists/e2e-birthday');
      const sort = page.getByRole('combobox', { name: 'Sort items by' });
      await sort.click();
      await expect(sort).toHaveAttribute('aria-expanded', 'true');
      await sort.click();
      await expect(sort).toHaveAttribute('aria-expanded', 'false');
      await expect(sort).toBeFocused();
      await sort.click();
      await expect(sort).toHaveAttribute('aria-expanded', 'true');
    });

    test('the Lists filter on All items closes on a second click', async ({ page }) => {
      await page.goto('/items');
      const trigger = page.getByRole('button', { name: /All lists/ });
      const all = page.getByRole('checkbox').first();
      await trigger.click();
      await expect(all).toBeVisible();
      await trigger.click();
      await expect(all).toBeHidden();
    });
  });
}
