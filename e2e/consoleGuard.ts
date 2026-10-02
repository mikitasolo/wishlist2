/**
 * The checks behind the console guard in `e2e/fixtures.ts`, kept free of
 * Playwright's runner so they can be unit-tested (`test/unit/consoleGuard.test.ts`).
 */

/** A console error or uncaught error one of a test's pages produced. */
export interface PageProblem {
  kind: 'console.error' | 'pageerror';
  /** The message, then where it was logged from: what the allow patterns are matched against. */
  line: string;
  /** The page's URL when it happened. */
  page: string;
}

/**
 * A console message as the allow patterns see it: `<text> (<url>)`, where the URL
 * is where it was logged from (no line number: a production chunk is one line).
 * For a failed load ("Failed to load resource: …") that's the resource's URL, so
 * a pattern can name the request that failed.
 */
export function consoleLine(text: string, url: string): string {
  return url ? `${text} (${url})` : text;
}

/**
 * The line the browser logs for a request whose URL path matches `path` (no
 * `^`/`$`: it's anchored here, after the origin and before any query) and that
 * got an error status or no answer at all ("Failed to load resource: the server
 * responded with a status of 500 …", "… net::ERR_INTERNET_DISCONNECTED"). For
 * `consoleErrors.allow` in a spec that fails that request on purpose. Keeps
 * `path`'s flags, e.g. `i`.
 */
export function failedRequest(path: RegExp): RegExp {
  return new RegExp(
    String.raw`^Failed to load resource: .+ \(https?://[^/]+(?:${path.source})(\?[^)]*)?\)$`,
    path.flags.replace(/[gy]/g, '')
  );
}

function matches(pattern: RegExp, line: string): boolean {
  pattern.lastIndex = 0; // a /g or /y pattern's test() would otherwise start mid-string
  return pattern.test(line);
}

/** The problems that fail the test: every uncaught error, and each console error no pattern allows. */
export function unexpectedProblems(
  problems: readonly PageProblem[],
  allowed: readonly RegExp[]
): PageProblem[] {
  return problems.filter(
    (p) => p.kind === 'pageerror' || !allowed.some((pattern) => matches(pattern, p.line))
  );
}

/** The failure message: each problem with the page it happened on, and what to do about it. */
export function reportProblems(problems: readonly PageProblem[]): string {
  return [
    `The page logged ${problems.length} unexpected console error(s) or uncaught error(s):`,
    ...problems.map(
      (p, i) => `  ${i + 1}. [${p.kind}] on ${p.page || '(no page yet)'}\n     ${p.line}`
    ),
    '',
    'Fix the cause. If the test provokes it on purpose (e.g. a request it fails),',
    'allow it in that test with consoleErrors.allow(/…/); see e2e/fixtures.ts.',
  ].join('\n');
}
