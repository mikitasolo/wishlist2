import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// regression: keyboard focus changed a control's shape (the global focus rule's
// `border-radius: 6px` beat every `rounded-*`), and no text field showed focus
// at all (`outline: none` with nothing in its place), WIS-233. Tabbing through
// the header, a list page and a dialog, every stop has to show focus and keep
// the radius it has at rest.

interface Stop {
  /** Focus left the page (its end) or came back round (a dialog's trap). */
  done: boolean;
  label: string;
  shows: boolean;
  radiusKept: boolean;
}

type TabState = {
  __radii: Map<Element, string>;
  __shadows: Map<Element, string>;
  __seen: Set<Element>;
};

/** Records every element's resting radius and shadow, before anything has focus. */
async function recordRadii(page: Page) {
  await page.evaluate(() => {
    const radii = new Map<Element, string>();
    const shadows = new Map<Element, string>();
    for (const el of document.querySelectorAll('*')) {
      const css = getComputedStyle(el);
      radii.set(el, css.borderRadius);
      shadows.set(el, css.boxShadow);
    }
    Object.assign(window, { __radii: radii, __shadows: shadows, __seen: new Set<Element>() });
  });
}

/** Presses Tab and reports on the element that took focus. */
async function tab(page: Page): Promise<Stop> {
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const el = document.activeElement!;
    const state = window as unknown as TabState;
    const done = el === document.body || state.__seen.has(el);
    state.__seen.add(el);
    const css = getComputedStyle(el);
    const outlined = css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0;
    // A text field shows focus with `field-focus`: a 2px ring on itself, or on
    // the wrapper that draws its border, that it didn't have at rest.
    let ringed = false;
    for (let node: Element | null = el, i = 0; node && i < 3; node = node.parentElement, i++) {
      const shadow = getComputedStyle(node).boxShadow;
      if (/0px 0px 0px 2px/.test(shadow) && shadow !== state.__shadows.get(node)) ringed = true;
    }
    const before = state.__radii.get(el);
    return {
      done,
      label: `${el.tagName.toLowerCase()} "${
        el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim().slice(0, 40) || ''
      }"`,
      shows: outlined || ringed,
      // Elements rendered after the radii were recorded have nothing to compare.
      radiusKept: before === undefined || before === css.borderRadius,
    };
  });
}

/** Tabs through every stop once, and fails on any that shows no focus or changes shape. */
async function tabThrough(page: Page, atLeast: number) {
  const problems: string[] = [];
  let stops = 0;
  for (; stops < 80; stops++) {
    const stop = await tab(page);
    if (stop.done) break;
    if (!stop.shows) problems.push(`${stop.label} shows no focus`);
    if (!stop.radiusKept) problems.push(`${stop.label} changes shape on focus`);
  }
  expect(problems).toEqual([]);
  expect(stops).toBeGreaterThanOrEqual(atLeast);
}

test('regression: the header and a list page show focus on every stop, in shape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/wishlists/e2e-birthday');
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await recordRadii(page);
  // The header, the list's actions, its filters and its item card.
  await tabThrough(page, 15);
});

// regression: a Menu's active item showed the focus outline as well as its
// background, where a Select's active option shows the background alone.
test("regression: a menu marks its active item with the background alone, as Select's does", async ({
  page,
}) => {
  await page.goto('/wishlists/e2e-birthday');
  const card = page.getByRole('article', { name: 'Item: E2E Gift' });
  await card.getByRole('button', { name: 'More actions' }).focus();
  await page.keyboard.press('Enter');
  const item = card.getByRole('menuitem').first();
  await expect(item).toBeFocused();
  const resting = await card
    .getByRole('menuitem')
    .nth(1)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await item.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  // Polled: the background fades in (`transition-colors`).
  await expect
    .poll(() => item.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(resting);
});

test('regression: a dialog shows focus on every field and control, in shape', async ({ page }) => {
  await page.goto('/wishlists/e2e-birthday');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await recordRadii(page);
  // Its fields, the photo's controls, Cancel and Add, and its close button,
  // until the trap brings focus back round.
  await tabThrough(page, 6);
});
