import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Accessibility violations the axe scan (`e2e/a11y.*.spec.ts`, WIS-383) lets
 * through, matched against `<rule id> on <screen>` (a screen's name is the one
 * its test passes to `seriousViolations`). Keep it short, give every entry a
 * comment saying why it's acceptable and which issue tracks the fix, and match
 * it as narrowly as you can: a rule allowed everywhere hides the next real
 * violation.
 *
 * Only `serious` and `critical` violations are scanned for, so `minor` and
 * `moderate` ones never need an entry.
 */
export const ALLOWED_A11Y_VIOLATIONS: readonly RegExp[] = [];

/** Runs axe on the page as it is now and returns its serious / critical violations, minus the allowed. */
export async function seriousViolations(page: Page, screen: string): Promise<string[]> {
  // Scan the loaded page, not its skeleton, and no frame of a transition
  // (axe's contrast check reads a half-faded colour as it is).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.skeleton')).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .filter((v) => !ALLOWED_A11Y_VIOLATIONS.some((p) => p.test(`${v.id} on ${screen}`)))
    .map(
      (v) =>
        `${v.id} (${v.impact}) on ${screen}: ${v.help}\n` +
        v.nodes
          .slice(0, 3)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary?.split('\n').join(' ')}`)
          .join('\n')
    );
}
