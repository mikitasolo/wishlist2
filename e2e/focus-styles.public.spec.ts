import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// regression: the base rules in app/globals.css sat outside any CSS layer, so
// they beat every Tailwind utility (which live in `@layer utilities`): `* {
// border-color }` turned every `border-*` colour into the 10% hairline, the
// focus rule's `border-radius: 6px` squared off round buttons on Tab, and the
// fields' `outline: none` left no text field showing focus (WIS-233). jsdom
// doesn't apply CSS layers, so these check the computed styles in a browser.

/** What `value` (a `var(--token)`) computes to for `property`, on this page's theme. */
async function resolved(page: Page, property: string, value: string): Promise<string> {
  return page.evaluate(
    ([prop, val]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(prop, val);
      if (prop.startsWith('border')) probe.style.borderStyle = 'solid';
      document.body.append(probe);
      const computed = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return computed;
    },
    [property, value] as const
  );
}

const style = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** Tabs from the top of the page until `target` has focus. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Tab never reached the target');
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    });

    test('regression: a border-border-strong field has the strong border colour', async ({
      page,
    }) => {
      await page.goto('/auth/signin');
      const email = page.getByLabel('Email address');
      await expect(email).toBeVisible();

      const strong = await resolved(page, 'border-top-color', 'var(--border-strong)');
      const hairline = await resolved(page, 'border-top-color', 'var(--border)');
      expect(strong).not.toBe(hairline);
      expect(await style(email, 'border-top-color')).toBe(strong);
    });

    test('regression: the sign-in email field shows its focus ring', async ({ page }) => {
      await page.goto('/auth/signin');
      const email = page.getByLabel('Email address');
      await tabTo(page, email);

      expect(await style(email, 'border-top-color')).toBe(
        await resolved(page, 'border-top-color', 'var(--ring)')
      );
      // The 2px halo of `ring-2`.
      expect(await style(email, 'box-shadow')).toMatch(/0px 0px 0px 2px/);
    });

    // Forced colors drop the border colour and the halo `field-focus` draws, so
    // a field turns the base outline off with `outline-hidden`, whose
    // transparent outline that mode still shows, never with `outline-none`.
    test('the sign-in email field still shows focus in forced-colors mode', async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await page.goto('/auth/signin');
      const email = page.getByLabel('Email address');
      await tabTo(page, email);
      expect(await style(email, 'outline-style')).toBe('solid');
      expect(parseFloat(await style(email, 'outline-width'))).toBeGreaterThan(0);
    });

    test('regression: a rounded-full button keeps its radius under keyboard focus', async ({
      page,
    }) => {
      await page.goto('/');
      const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
      await expect(signIn).toBeVisible();
      const radius = await style(signIn, 'border-top-left-radius');
      expect(parseFloat(radius)).toBeGreaterThan(1000);

      await tabTo(page, signIn);
      expect(await signIn.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      expect(await style(signIn, 'outline-style')).toBe('solid');
      expect(await style(signIn, 'border-top-left-radius')).toBe(radius);
    });
  });
}
