import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';

// WIS-381: the server SDK exactly as instrumentation.ts starts it (only the
// transport swapped for one that keeps what would have been sent). What Next
// hands onRequestError (the request's headers, cookie and X-Share-Token
// included, and its /l/<token> path) and a route's console.error must arrive
// scrubbed, once each.

const sent = vi.hoisted(() => [] as string[]);

vi.mock('@sentry/nextjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sentry/nextjs')>();
  return {
    // The package is CommonJS: its full export list is on `default`.
    ...(real as unknown as { default: object }).default,
    ...real,
    init: (options: Parameters<typeof real.init>[0]) =>
      real.init({
        ...options,
        transport: () => ({
          send: async (envelope: unknown) => {
            sent.push(JSON.stringify(envelope));
            return {};
          },
          flush: async () => true,
        }),
      }),
  };
});

const TOKEN = 'aB3dE5gH7jK9mN1pQ3sT5v';
let onRequestError: typeof import('@/instrumentation').onRequestError;

beforeAll(async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SENTRY_DSN', 'https://abc123@o1.ingest.sentry.io/42');
  const instrumentation = await import('@/instrumentation');
  await instrumentation.register();
  onRequestError = instrumentation.onRequestError;
  expect(Sentry.getClient()).toBeDefined();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await Sentry.close();
});

/**
 * What was sent since the last call, as text. Stack frames' source lines are
 * left out: they're our own code (here, this file, which spells out the very
 * values the tests look for), not anything a person sent.
 */
async function flushed(): Promise<string> {
  await Sentry.flush(2000);
  const all = sent
    .join('\n')
    .replace(/"(pre_context|post_context)":\[(?:"(?:[^"\\]|\\.)*",?)*\]/g, '"$1":[]')
    .replace(/"context_line":"(?:[^"\\]|\\.)*"/g, '"context_line":""');
  sent.length = 0;
  return all;
}

describe('server error reports', () => {
  it('scrubs what onRequestError reports', async () => {
    await onRequestError(
      new Error('No invite for ann@example.com'),
      {
        path: `/l/${TOKEN}?from=ann%40example.com`,
        method: 'GET',
        headers: {
          cookie: 'authjs.session-token=sess-secret',
          'x-share-token': TOKEN,
          authorization: 'Bearer auth-secret',
          referer: `https://wishlist.example/l/${TOKEN}`,
          'user-agent': 'Mozilla/5.0',
        },
      },
      {
        routerKind: 'App Router',
        routePath: '/l/[token]',
        routeType: 'render',
        renderSource: 'react-server-components',
        revalidateReason: undefined,
      }
    );
    const out = await flushed();
    expect(out).toContain('No invite for [Filtered]');
    expect(out).toContain('/l/[token]');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('sess-secret');
    expect(out).not.toContain('auth-secret');
    expect(out).not.toContain('example.com');
  });

  it('reports a console.error, scrubbed', async () => {
    console.error('Error inviting', 'ann@example.com', new Error(`at /users/annlee`));
    const out = await flushed();
    expect(out).toContain('/users/[username]');
    expect(out).not.toContain('annlee');
    expect(out).not.toContain('example.com');
  });

  // regression: a Node process warning reached stderr through console.error
  // and was reported as an error on every cold start (Sentry WISHLIST-2).
  it("doesn't report Node's own process warnings", async () => {
    console.error(
      '(node:6) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)'
    );
    console.error(
      '(node:6) MaxListenersExceededWarning: Possible EventEmitter memory leak detected'
    );
    const out = await flushed();
    expect(out).not.toContain('ExperimentalWarning');
    expect(out).not.toContain('memory leak');
    console.error('Error saving item: Warning: stock low');
    expect(await flushed()).toContain('stock low');
  });

  it('sends no user, even when one is set on the scope', async () => {
    Sentry.withScope((scope) => {
      scope.setUser({
        id: '64b7f0c2a1d3e4f5a6b7c8d9',
        email: 'ann@example.com',
        username: 'annlee',
      });
      Sentry.captureException(new Error('boom'));
    });
    const out = await flushed();
    expect(out).toContain('boom');
    expect(out).not.toContain('"user"');
    expect(out).not.toContain('annlee');
  });

  it('sends an error Next both hands onRequestError and logs only once', async () => {
    const error = new Error('route blew up');
    await onRequestError(
      error,
      { path: '/api/items', method: 'POST', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/api/items',
        routeType: 'route',
        renderSource: undefined,
        revalidateReason: undefined,
      }
    );
    console.error(error);
    const out = await flushed();
    expect(out.match(/route blew up/g)?.length).toBe(1);
  });
});
