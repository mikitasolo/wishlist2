import { describe, it, expect, vi, afterEach } from 'vitest';
import { UMAMI_HOST_URL, UMAMI_SCRIPT_URL } from '@/lib/analytics';
import { getSentryDsn } from '@/lib/monitoring/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextConfig = require('../../next.config.js') as {
  agentRules?: boolean;
  logging?: false | { serverFunctions?: boolean };
  htmlLimitedBots?: RegExp;
  outputFileTracingIncludes?: Record<string, string[]>;
};
const { HTML_LIMITED_BOT_UA_RE } = require('next/dist/shared/lib/router/utils/html-bots') as {
  HTML_LIMITED_BOT_UA_RE: RegExp;
};

describe('next.config.js', () => {
  // regression: Next 16.3's `next dev` appends a "nextjs-agent-rules" block to
  // AGENTS.md when it detects an AI coding agent, unless `agentRules` is false,
  // so every workspace running the dev server got an uncommitted AGENTS.md.
  it('stops `next dev` from writing into AGENTS.md', () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  // regression: once sign-in moved to a server action (WIS-38), `next dev`
  // logged each call with its arguments, printing the typed email to the
  // terminal. Only that log is off; the rest of Next's logging stays.
  it('stops `next dev` from logging server function arguments', () => {
    expect(nextConfig.logging).toEqual({ serverFunctions: false });
  });

  describe('htmlLimitedBots', () => {
    const bots = nextConfig.htmlLimitedBots!;

    // regression: Next streams a dynamic page's metadata into <body> for any
    // agent outside its list, so a preview bot that reads only <head> showed the
    // site's defaults instead of the shared list or profile.
    it.each([
      ['Telegram', 'TelegramBot (like TwitterBot)'],
      ['Telegram, should it drop "like TwitterBot"', 'TelegramBot/2.0'],
      ['Viber', 'Viber/23.0 (Link preview)'],
      ['Pinterest', 'Pinterestbot/1.0 (+https://www.pinterest.com/bot.html)'],
      ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.3.0; +https://mastodon.social/)'],
      ['Bluesky', 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)'],
      ['Snapchat', 'Snapchat/12.0 (link preview)'],
      ['OK.ru', 'Mozilla/5.0 (compatible; OdklBot/1.0 like Linux; klass@odnoklassniki.ru)'],
      ['Outlook / Teams', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MicrosoftPreview/2.0'],
      ['Iframely', 'Iframely/1.3.1 (+https://iframely.com/docs/about)'],
      ['Facebook / Instagram / iMessage', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0'],
      ['WhatsApp', 'WhatsApp/2.23.20.0'],
      ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
      ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ])('gives %s the metadata in <head>', (_, ua) => {
      expect(bots.test(ua)).toBe(true);
    });

    // Setting the option replaces Next's own list, so dropping it would take
    // Google, Bing and the rest off it.
    it("keeps every bot on Next's own list", () => {
      expect(bots.source.startsWith(HTML_LIMITED_BOT_UA_RE.source)).toBe(true);
      expect(bots.flags).toContain('i');
    });

    it('leaves browsers on streamed metadata', () => {
      for (const ua of [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      ]) {
        expect(bots.test(ua)).toBe(false);
      }
    });
  });

  // The share cards read their fonts from disk, and ship sharp's native binding
  // (next/og rasterizes with it, a list's or profile's card converts its photo
  // with it), which needs libvips shipped alongside it (WIS-156).
  it.each([
    '/opengraph-image',
    '/wishlists/[id]/opengraph-image',
    '/users/[username]/opengraph-image',
    '/l/[token]/opengraph-image',
  ])('ships the fonts and libvips with %s', (route) => {
    const files = nextConfig.outputFileTracingIncludes?.[route] ?? [];
    expect(files).toContain('./lib/og/fonts/*.ttf');
    expect(files).toContain('./node_modules/@img/sharp-libvips-*/lib/**/*');
  });

  // libvips ships only with what runs sharp: the share cards above and the
  // upload route. Sign-in used to need it for the email logo, which is now
  // pre-rendered (WIS-208); `npm run check:trace` checks the build itself.
  it('ships libvips with the upload routes, and with nothing else but the share cards', () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    expect(includes['/api/upload']).toEqual(['./node_modules/@img/sharp-libvips-*/lib/**/*']);
    // WIS-366: re-hosting an image from its URL runs the same sharp pipeline.
    expect(includes['/api/upload/from-url']).toEqual([
      './node_modules/@img/sharp-libvips-*/lib/**/*',
    ]);
    const withLibvips = Object.keys(includes).filter((route) =>
      includes[route].some((file) => file.includes('sharp-libvips'))
    );
    expect(withLibvips.sort()).toEqual([
      '/api/upload',
      '/api/upload/from-url',
      '/l/[token]/opengraph-image',
      '/opengraph-image',
      '/users/[username]/opengraph-image',
      '/wishlists/[id]/opengraph-image',
    ]);
  });
});

// WIS-329: Umami is allowed by the CSP exactly where the app loads it
// (getUmamiWebsiteId): on Production with a website id. Anywhere else the
// policy stays as it was, so nothing could load or post to it.
describe('next.config.js — the CSP for analytics', () => {
  const CONFIG = require.resolve('../../next.config.js');
  const ID = '8f14e45f-ceea-467a-9575-0c3c1a4b2e6d';

  /** next.config.js evaluated afresh under the env stubbed for the test. */
  async function csp(): Promise<Record<string, string>> {
    delete require.cache[CONFIG];
    const fresh = require(CONFIG) as {
      headers: () => Promise<{ headers: { key: string; value: string }[] }[]>;
    };
    const [{ headers }] = await fresh.headers();
    const value = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    return Object.fromEntries(
      value.split('; ').map((d) => [d.split(' ')[0], d.slice(d.indexOf(' ') + 1)])
    );
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    delete require.cache[CONFIG];
  });

  it('allows Umami’s script and endpoint on Production with a website id', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', ID);
    const policy = await csp();
    expect(policy['script-src']).toContain(new URL(UMAMI_SCRIPT_URL).origin);
    expect(policy['connect-src']).toContain(new URL(UMAMI_HOST_URL).origin);
    // Nothing else of Umami's.
    expect(policy['img-src']).not.toContain('umami');
    expect(policy['frame-src']).not.toContain('umami');
  });

  it.each([
    ['no website id on Production', 'production', undefined],
    ['a malformed website id on Production', 'production', 'abc'],
    ['staging / previews', 'preview', ID],
    ['local dev, CI and E2E', undefined, ID],
  ])('allows nothing of Umami’s with %s', async (_label, env, id) => {
    vi.stubEnv('VERCEL_ENV', env);
    vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', id);
    const policy = await csp();
    expect(Object.values(policy).join(' ')).not.toContain('umami');
  });
});

// WIS-381: the browser SDK's reports go to the DSN's ingest host, allowed by
// the CSP exactly where the app starts the SDK (getSentryDsn): on Production
// with a well-formed DSN. Anywhere else the policy stays as it was.
describe('next.config.js — the CSP for error monitoring', () => {
  const CONFIG = require.resolve('../../next.config.js');
  const DSN = 'https://0123456789abcdef0123456789abcdef@o4507.ingest.de.sentry.io/4507123';

  async function csp(): Promise<Record<string, string>> {
    delete require.cache[CONFIG];
    const fresh = require(CONFIG) as {
      headers: () => Promise<{ headers: { key: string; value: string }[] }[]>;
    };
    const [{ headers }] = await fresh.headers();
    const value = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    return Object.fromEntries(
      value.split('; ').map((d) => [d.split(' ')[0], d.slice(d.indexOf(' ') + 1)])
    );
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    delete require.cache[CONFIG];
  });

  it('allows the DSN’s ingest host to be posted to, on Production with a DSN', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SENTRY_DSN', DSN);
    // The layout starts the SDK under the same condition.
    expect(getSentryDsn()).toBe(DSN);
    const policy = await csp();
    expect(policy['connect-src']).toContain('https://o4507.ingest.de.sentry.io');
    expect(policy['script-src']).not.toContain('sentry');
  });

  it.each([
    ['no DSN on Production', 'production', undefined],
    ['a malformed DSN on Production', 'production', 'https://sentry.io'],
    ['staging / previews', 'preview', DSN],
    ['local dev, CI and E2E', undefined, DSN],
  ])('allows nothing of Sentry’s with %s', async (_label, env, dsn) => {
    vi.stubEnv('VERCEL_ENV', env);
    vi.stubEnv('SENTRY_DSN', dsn);
    expect(getSentryDsn()).toBeNull();
    const policy = await csp();
    expect(Object.values(policy).join(' ')).not.toContain('sentry');
  });
});
