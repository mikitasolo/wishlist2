import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// regression: keyboard focus changed a control's shape (the global focus rule's
// `border-radius: 6px` beat every `rounded-*`), and no text field showed focus
// at all (`outline: none` with nothing in its place), WIS-233. Tabbing through
// the header, a list page and a dialog, every stop has to show focus and keep
// the radius it has at rest.

interface Stop {
  label: string;
  shows: boolean;
  radiusKept: boolean;
}

/** Records every focusable element's resting radius, before anything has focus. */
async function recordRadii(page: Page) {
  await page.evaluate(() => {
    const radii = new Map<Element, string>();
    for (const el of document.querySelectorAll('*')) {
      radii.set(el, getComputedStyle(el).borderRadius);
    }
    (window as unknown as { __radii: Map<Element, string> }).__radii = radii;
  });
}

/** Presses Tab and reports on the element that took focus. */
async function tab(page: Page): Promise<Stop> {
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const el = document.activeElement!;
    const css = getComputedStyle(el);
    const outlined = css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0;
    // A text field shows focus with `field-focus`: a 2px ring on itself, or on
    // the wrapper that draws its border.
    let ringed = false;
    for (let node: Element | null = el, i = 0; node && i < 3; node = node.parentElement, i++) {
      if (/0px 0px 0px 2px/.test(getComputedStyle(node).boxShadow)) ringed = true;
    }
    const before = (window as unknown as { __radii: Map<Element, string> }).__radii.get(el);
    return {
      label: `${el.tagName.toLowerCase()} "${
        el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim().slice(0, 40) || ''
      }"`,
      shows: outlined || ringed,
      // Elements rendered after the radii were recorded have nothing to compare.
      radiusKept: before === undefined || before === css.borderRadius,
    };
  });
}

async function tabThrough(page: Page, stops: number) {
  const problems: string[] = [];
  for (let i = 0; i < stops; i++) {
    const stop = await tab(page);
    if (!stop.shows) problems.push(`${stop.label} shows no focus`);
    if (!stop.radiusKept) problems.push(`${stop.label} changes shape on focus`);
  }
  expect(problems).toEqual([]);
}

test('regression: the header and a list page show focus on every stop, in shape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/wishlists/e2e-birthday');
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await recordRadii(page);
  // The header, the list's actions, its filters and its item cards.
  await tabThrough(page, 20);
});

test('regression: a dialog shows focus on every field and control, in shape', async ({ page }) => {
  await page.goto('/wishlists/e2e-birthday');
  await page.getByRole('button', { name: '+ Add Item' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await recordRadii(page);
  // Focus is trapped in the dialog, so this goes round its stops.
  await tabThrough(page, 12);
});
