import { describe, it, expect } from 'vitest';
import { RUNS_SHARP, SHARP_FREE, traceProblems } from '@/scripts/check-native-trace.mjs';

const BINDING = 'node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node';
const LIBVIPS = 'node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.7';
const OTHER = 'node_modules/next/dist/server/next-server.js';
const API_ROUTE = 'api/wishlists/[id]/route.js.nft.json';
const PAGE = 'auth/signin/page.js.nft.json';

/**
 * A build as it should be: whatever runs sharp ships it with libvips, NextAuth's
 * route ships none, and a page carries the binding without libvips (every page
 * imports the share cards' modules for their metadata, but never draws one).
 */
function healthyBuild(): Map<string, string[]> {
  return new Map([
    ...RUNS_SHARP.map((trace): [string, string[]] => [trace, [OTHER, BINDING, LIBVIPS]]),
    ...SHARP_FREE.map((trace): [string, string[]] => [trace, [OTHER]]),
    [API_ROUTE, [OTHER]],
    [PAGE, [OTHER, BINDING]],
  ]);
}

describe('npm run check:trace', () => {
  it('passes a build that ships libvips with every route that ships sharp', () => {
    const { problems, shipping } = traceProblems(healthyBuild());

    expect(problems).toEqual([]);
    expect(shipping).toEqual(RUNS_SHARP);
  });

  // regression: Next's tracing ships sharp's binding but not the libvips it
  // links, so on Vercel such a route 500s on its first `import('sharp')`
  // (WIS-156). The check must still catch that.
  // (`route.js.nft.json` alone: a route at the top of the app directory.)
  it.each([RUNS_SHARP[0], RUNS_SHARP[1], API_ROUTE, 'route.js.nft.json'])(
    'fails a build in which %s ships the binding without libvips',
    (trace) => {
      const build = healthyBuild();
      build.set(trace, [OTHER, BINDING]);

      expect(traceProblems(build).problems).toEqual([
        `${trace}: ships sharp's native binding but not libvips (libvips-cpp.*)`,
      ]);
    }
  );

  // Sign-in doesn't depend on sharp since the email logo is pre-rendered
  // (WIS-208), so sharp turning up in NextAuth's route fails, even with libvips.
  it.each(SHARP_FREE)('fails a build in which %s ships sharp', (trace) => {
    const build = healthyBuild();
    build.set(trace, [OTHER, BINDING, LIBVIPS]);

    expect(traceProblems(build).problems).toEqual([
      `${trace}: ships sharp's native binding, but sign-in mustn't depend on sharp`,
    ]);
  });

  it('fails a build in which a route that runs sharp ships none, or a trace is missing', () => {
    const build = healthyBuild();
    build.set(RUNS_SHARP[0], [OTHER]);
    build.delete(RUNS_SHARP[1]);
    build.delete(SHARP_FREE[0]);

    expect(traceProblems(build).problems).toEqual([
      `${RUNS_SHARP[1]}: trace file missing`,
      `${SHARP_FREE[0]}: trace file missing`,
      `${RUNS_SHARP[0]}: expected sharp's native binding in the trace, found none`,
    ]);
  });

  // The wasm build has no native library to ship.
  it("ignores sharp's wasm build", () => {
    const build = healthyBuild();
    build.set(API_ROUTE, ['node_modules/@img/sharp-wasm32/lib/sharp-wasm32.node']);

    expect(traceProblems(build).problems).toEqual([]);
  });
});
