import { describe, it, expect } from 'vitest';
import {
  consoleLine,
  failedRequest,
  reportProblems,
  unexpectedProblems,
  type PageProblem,
} from '../../e2e/consoleGuard';

// The E2E console guard (e2e/fixtures.ts): which page problems fail a spec.

const ORIGIN = 'http://localhost:3101';
const ITEMS_URL = `${ORIGIN}/api/wishlists/e2e-birthday/items`;
const SERVER_500 = 'Failed to load resource: the server responded with a status of 500 ()';

const failedRead: PageProblem = {
  kind: 'console.error',
  line: consoleLine(SERVER_500, ITEMS_URL),
  page: `${ORIGIN}/wishlists/e2e-birthday`,
};
const appLog: PageProblem = {
  kind: 'console.error',
  line: consoleLine(
    'Error fetching items: Error: Something went wrong',
    `${ORIGIN}/_next/static/chunks/app.js`
  ),
  page: `${ORIGIN}/wishlists/e2e-birthday`,
};
const thrown: PageProblem = {
  kind: 'pageerror',
  line: 'TypeError: Cannot read properties of undefined',
  page: `${ORIGIN}/`,
};

describe('consoleLine', () => {
  it('names where the message came from after it, so a pattern can match the request', () => {
    expect(failedRead.line).toBe(`${SERVER_500} (${ITEMS_URL})`);
    expect(appLog.line).toBe(
      `Error fetching items: Error: Something went wrong (${ORIGIN}/_next/static/chunks/app.js)`
    );
  });

  it('is the bare text when the message has no location', () => {
    expect(consoleLine('Boom', '')).toBe('Boom');
  });
});

describe('failedRequest', () => {
  const items = failedRequest(/\/api\/wishlists\/[^/]+\/items/);

  it('matches the browser’s line for that request, whatever the status or network error', () => {
    expect(items.test(failedRead.line)).toBe(true);
    expect(
      items.test(consoleLine('Failed to load resource: net::ERR_INTERNET_DISCONNECTED', ITEMS_URL))
    ).toBe(true);
    expect(items.test(consoleLine(SERVER_500, `${ITEMS_URL}?cursor=2`))).toBe(true);
  });

  it('matches no other request, and none of the app’s own lines', () => {
    expect(
      items.test(consoleLine(SERVER_500, `${ORIGIN}/api/items/6abff7a6d5117177052ab029`))
    ).toBe(false);
    expect(items.test(consoleLine(SERVER_500, `${ITEMS_URL}/extra`))).toBe(false);
    expect(items.test(appLog.line)).toBe(false);
  });

  it('anchors a path with alternatives as a whole, and keeps its flags', () => {
    const either = failedRequest(/\/api\/items\/a|\/api\/items\/b/);
    expect(either.test(consoleLine(SERVER_500, `${ORIGIN}/api/items/b`))).toBe(true);
    expect(either.test(consoleLine(SERVER_500, `${ORIGIN}/api/items/a/extra`))).toBe(false);
    expect(
      failedRequest(/\/API\/ITEMS\/a/i).test(consoleLine(SERVER_500, `${ORIGIN}/api/items/a`))
    ).toBe(true);
  });
});

describe('unexpectedProblems', () => {
  it('fails on every console error when nothing is allowed', () => {
    expect(unexpectedProblems([failedRead, appLog], [])).toEqual([failedRead, appLog]);
  });

  it('lets through only the console errors a pattern matches', () => {
    expect(
      unexpectedProblems([failedRead, appLog], [failedRequest(/\/api\/wishlists\/[^/]+\/items/)])
    ).toEqual([appLog]);
    expect(unexpectedProblems([failedRead, appLog], [/^Error fetching items: /])).toEqual([
      failedRead,
    ]);
  });

  it('never lets an uncaught page error through, whatever is allowed', () => {
    expect(unexpectedProblems([thrown], [/.*/])).toEqual([thrown]);
  });

  it('matches a /g pattern on every line, not every other one', () => {
    const again = { ...appLog };
    expect(unexpectedProblems([appLog, again], [/Error fetching items/g])).toEqual([]);
  });
});

describe('reportProblems', () => {
  it('lists each problem with the page it happened on', () => {
    const report = reportProblems([failedRead, thrown]);
    expect(report).toContain('2 unexpected console error(s) or uncaught error(s)');
    expect(report).toContain(`1. [console.error] on ${failedRead.page}\n     ${failedRead.line}`);
    expect(report).toContain(`2. [pageerror] on ${thrown.page}\n     ${thrown.line}`);
    expect(report).toContain('consoleErrors.allow');
  });
});
