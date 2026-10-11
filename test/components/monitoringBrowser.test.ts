// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// WIS-381: the browser SDK as lib/monitoring/browser.ts starts it, with a
// transport that keeps what would have been sent. The page's URL (a /l/ link
// with a token, a query naming a person), its referrer and the DOM must arrive
// scrubbed or not at all.

const sent = vi.hoisted(() => [] as string[]);
const init = vi.hoisted(() => vi.fn());

vi.mock('@sentry/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sentry/browser')>();
  return {
    ...real,
    init: (options: Parameters<typeof real.init>[0]) => {
      init(options);
      return real.init({
        ...options,
        transport: () => ({
          send: async (envelope) => {
            sent.push(JSON.stringify(envelope));
            return {};
          },
          flush: async () => true,
        }),
      });
    },
  };
});

const TOKEN = 'aB3dE5gH7jK9mN1pQ3sT5v';
const DSN = 'https://abc123@o1.ingest.sentry.io/42';

async function load() {
  const browser = await import('@/lib/monitoring/browser');
  const Sentry = await import('@sentry/browser');
  return { ...browser, Sentry };
}

async function flushed(Sentry: typeof import('@sentry/browser')): Promise<string> {
  await Sentry.flush(2000);
  const all = sent.join('\n');
  sent.length = 0;
  return all;
}

beforeEach(() => {
  sent.length = 0;
  init.mockReset();
});

describe('browser error monitoring', () => {
  // regression: a page that broke on its first render was never reported: its
  // error boundary ran before ErrorMonitoring's effect had started the SDK, and
  // reportError dropped the error.
  it('loads nothing until it’s started, then sends what was caught before', async () => {
    vi.resetModules();
    const { reportError, startBrowserMonitoring, Sentry } = await load();
    reportError(new Error('broke on first render'));
    await new Promise((r) => setTimeout(r, 0));
    expect(init).not.toHaveBeenCalled();
    expect(sent).toEqual([]);

    await startBrowserMonitoring(DSN);
    const out = await flushed(Sentry);
    expect(out).toContain('broke on first render');
    await Sentry.close();
  });

  it('scrubs the page URL and referrer, and drops DOM breadcrumbs', async () => {
    vi.resetModules();
    const { startBrowserMonitoring, reportError, resetBrowserMonitoringForTests, Sentry } =
      await load();
    resetBrowserMonitoringForTests();
    window.history.pushState({}, '', `/l/${TOKEN}?email=ann%40example.com#x`);
    Object.defineProperty(document, 'referrer', {
      value: `https://wishlist.example/l/${TOKEN}`,
      configurable: true,
    });
    expect(await startBrowserMonitoring(DSN, 'abc')).not.toBeNull();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({ sendDefaultPii: false, dsn: DSN });
    expect(init.mock.calls[0][0]).not.toHaveProperty('tracesSampleRate');

    // A click on an avatar named after a person.
    const img = document.createElement('img');
    img.alt = 'Ann Lee';
    document.body.appendChild(img);
    img.click();

    reportError(new Error('No list for ann@example.com'));
    await new Promise((r) => setTimeout(r, 0));
    const out = await flushed(Sentry);
    expect(out).toContain('No list for [Filtered]');
    expect(out).toContain('/l/[token]');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('example.com');
    expect(out).not.toContain('Ann Lee');
    expect(out).not.toContain('Referer');
    // Errors only: no session envelope.
    expect(out).not.toContain('"type":"session"');
  });

  it('starts once, and doesn’t report an error the server already reported', async () => {
    const { startBrowserMonitoring, reportError, Sentry } = await load();
    await startBrowserMonitoring(DSN);
    expect(init).not.toHaveBeenCalled(); // already started by the test above

    const serverError = Object.assign(new Error('render failed'), { digest: '12345' });
    reportError(serverError);
    await new Promise((r) => setTimeout(r, 0));
    expect(await flushed(Sentry)).toBe('');
  });
});
