import { test, expect } from './fixtures';

// The console guard itself (e2e/fixtures.ts), on a blank page so nothing of the
// app's can get in the way.

test('the guard sees an unexpected console.error, and lets the spec allow it', async ({
  page,
  consoleErrors,
}) => {
  await page.setContent('<p>guard check</p>');
  await page.evaluate(() => {
    console.warn('WIS-215 guard check: a warning');
    console.error('WIS-215 guard check: console.error');
  });
  // Only the error counts, not the warning.
  await expect
    .poll(() => consoleErrors.unexpected().map((p) => `${p.kind}: ${p.line}`))
    .toEqual([expect.stringMatching(/^console\.error: WIS-215 guard check: console\.error\b/)]);

  consoleErrors.allow(/^WIS-215 guard check: console\.error\b/);
  expect(consoleErrors.unexpected()).toEqual([]);
});

test('the guard watches a context the spec opens itself, once handed to it', async ({
  browser,
  consoleErrors,
}) => {
  const context = await browser.newContext();
  consoleErrors.watch(context);
  const page = await context.newPage();
  await page.setContent('<p>guard check</p>');
  await page.evaluate(() => console.error('WIS-215 guard check: other context'));
  await expect.poll(() => consoleErrors.unexpected().length).toBe(1);
  consoleErrors.allow(/^WIS-215 guard check: other context\b/);
  await context.close();
});

// The rest have to fail, which `test.fail()` turns into a pass: each passes only
// if the guard fails it at the end, so a guard that stopped failing specs turns
// them red. Each first checks the guard saw what it's about to fail on, with the
// same steps as the tests above, which fail outright if those steps break.

test('the guard fails a spec whose page logs an unexpected console.error', async ({
  page,
  consoleErrors,
}) => {
  test.fail();
  await page.setContent('<p>guard check</p>');
  await page.evaluate(() => console.error('WIS-215 guard check: console.error'));
  await expect.poll(() => consoleErrors.unexpected().length).toBe(1);
});

test('the guard fails a spec whose page throws an uncaught error, which no pattern allows', async ({
  page,
  consoleErrors,
}) => {
  test.fail();
  consoleErrors.allow(/.*/);
  await page.setContent('<p>guard check</p>');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('WIS-215 guard check: uncaught error');
    });
  });
  await expect.poll(() => consoleErrors.unexpected().map((p) => p.kind)).toEqual(['pageerror']);
});

test('the guard fails a spec whose page leaves a promise rejection unhandled', async ({
  page,
  consoleErrors,
}) => {
  test.fail();
  consoleErrors.allow(/.*/);
  await page.setContent('<p>guard check</p>');
  await page.evaluate(() => {
    void Promise.reject(new Error('WIS-215 guard check: unhandled rejection'));
  });
  await expect.poll(() => consoleErrors.unexpected().map((p) => p.kind)).toEqual(['pageerror']);
});
