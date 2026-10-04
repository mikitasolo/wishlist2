import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  consoleLine,
  failedRequest,
  reportProblems,
  unexpectedProblems,
  type PageProblem,
} from './consoleGuard';

/**
 * Every spec imports `test` and `expect` from here, not from `@playwright/test`
 * (ESLint refuses that): this `test` fails a spec whose pages log a
 * `console.error` that isn't allowed, or throw an uncaught error (`pageerror`,
 * an unhandled promise rejection included). A console full of expected noise
 * hides the next real error, so a new one fails the suite instead (WIS-215).
 *
 * Only errors count: warnings and logs don't fail a spec. The test's own
 * context is watched (the `page` fixture, and any popup); a context the spec
 * opens itself (`browser.newContext()`) is only once it's handed to
 * `consoleErrors.watch`.
 */

/**
 * `console.error` messages any spec may log, matched against `<text> (<url>)`
 * (see `consoleLine`). Keep it short, give every entry a comment saying why
 * it's acceptable and which issue tracks it, and match it as narrowly as you
 * can: a broad pattern hides our own errors along with the one it's meant for.
 *
 * A failure a spec provokes on purpose (a request it answers with a 500)
 * doesn't go here: that spec allows it itself, with `consoleErrors.allow`.
 *
 * Empty: nothing the suite visits logs an error on the production build it
 * runs. The third-party noise a deployment adds (Turnstile's challenge iframe,
 * Vercel's toolbar on Preview, both listed in WIS-215) never reaches it, since
 * the suite runs with Turnstile off and outside Vercel.
 */
const ALLOWED_CONSOLE_ERRORS: readonly RegExp[] = [];

export interface ConsoleErrors {
  /**
   * Lets this test log `console.error` messages matching any of `patterns`, for
   * a failure it provokes on purpose: a request it answers with an error status
   * or aborts (the browser logs "Failed to load resource: …" with the request's
   * URL: match it with `failedRequest(/…path…/)`), and the app's own log line
   * for that failure (`/^Error updating item: /`). Matched against
   * `<text> (<url>)`, like `ALLOWED_CONSOLE_ERRORS`. An uncaught page error
   * can't be allowed.
   */
  allow(...patterns: RegExp[]): void;
  /** Guards the pages of a context the spec opened itself, as the test's own are. */
  watch(context: BrowserContext): void;
  /** What would fail the test if it ended now. */
  unexpected(): PageProblem[];
}

export { failedRequest };

export const test = base.extend<{ consoleErrors: ConsoleErrors }>({
  consoleErrors: [
    async ({ context }, use) => {
      const problems: PageProblem[] = [];
      const allowed: RegExp[] = [...ALLOWED_CONSOLE_ERRORS];

      const watchPage = (page: Page) => {
        page.on('console', (msg) => {
          if (msg.type() !== 'error') return;
          problems.push({
            kind: 'console.error',
            line: consoleLine(msg.text(), msg.location().url),
            page: page.url(),
          });
        });
        page.on('pageerror', (error) => {
          problems.push({
            kind: 'pageerror',
            line: error.stack || `${error.name}: ${error.message}`,
            page: page.url(),
          });
        });
      };
      const watch = (watched: BrowserContext) => {
        watched.pages().forEach(watchPage);
        watched.on('page', watchPage);
      };
      watch(context);

      await use({
        allow: (...patterns) => allowed.push(...patterns),
        watch,
        unexpected: () => unexpectedProblems(problems, allowed),
      });

      // A handler that calls `route.fetch()` can still be mid-request when the
      // test ends (a poll landing just then), which Playwright reports as an
      // error outside any test and fails the run (WIS-216). Drop the routes and
      // let those fetches die quietly.
      await Promise.all(
        context.pages().map((page) => page.unrouteAll({ behavior: 'ignoreErrors' }))
      );
      await context.unrouteAll({ behavior: 'ignoreErrors' });

      const unexpected = unexpectedProblems(problems, allowed);
      if (unexpected.length > 0) throw new Error(reportProblems(unexpected));
    },
    { auto: true },
  ],
});

export { expect };
