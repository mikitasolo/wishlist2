#!/usr/bin/env node
// Run after `next build`. Fails if a route (an API route, a share card) ships
// sharp's native binding without the libvips shared library the binding links
// (WIS-156), if a route that runs sharp ships no binding at all, or if NextAuth's
// route ships it (WIS-208).
//
// Next's output file tracing follows `require`s, not the dynamic linker: it
// copies `@img/sharp-<platform>/lib/sharp-*.node` into a route's bundle but
// not `@img/sharp-libvips-<platform>/lib/libvips-cpp.*`, which that binding
// loads at runtime. On Vercel the route then crashes on its first
// `import('sharp')` with ERR_DLOPEN_FAILED. `outputFileTracingIncludes` in
// next.config.js ships the library; this check keeps it that way.
//
// Pages aren't held to it. Every page's trace carries the binding, because Next
// imports the share cards' modules (app/opengraph-image.tsx and the rest) into
// every page to read their `alt`, `size` and `contentType`, and those import
// next/og. A page never draws a card, so it never loads sharp, and shipping
// libvips with every page would only make each one heavier. A page that does run
// sharp (its render or a server action) goes into outputFileTracingIncludes and
// RUNS_SHARP below.
import { readFileSync, readdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = '.next/server/app';

// What runs sharp, and so has to ship it with libvips. Also makes sure the check
// can't pass by finding nothing: the upload route re-encodes every upload with
// sharp, and next/og draws a list's, share link's or profile's share card with it, which also
// converts the card's banner or avatar (lib/og/photo.ts).
export const RUNS_SHARP = [
  'api/upload/route.js.nft.json',
  'wishlists/[id]/opengraph-image/route.js.nft.json',
  'users/[username]/opengraph-image/route.js.nft.json',
  'l/[token]/opengraph-image/route.js.nft.json',
];

// Sign-in doesn't depend on sharp. Sending an email needs none, because its logo
// is pre-rendered (lib/emailLogo.ts), so NextAuth's route, which sends the magic
// link's email and checks every session, ships no sharp at all. The binding
// turning up in it means something on the way to a sign-in loads sharp again,
// which can take sign-in down as it did in WIS-156. (The sign-in page's trace
// carries the binding like every page's, see above, but nothing on it loads it.)
export const SHARP_FREE = ['api/auth/[...nextauth]/route.js.nft.json'];

const BINDING = /@img\/sharp-(?!wasm32)[^/]+\/lib\/sharp-[^/]+\.node$/;
const LIBVIPS = /@img\/sharp-libvips-[^/]+\/lib\/libvips-cpp\.[^/]+$/;
const isRoute = (trace) => basename(trace) === 'route.js.nft.json';

/**
 * What's wrong with a build's traces.
 *
 * @param {Map<string, string[]>} traces each route's and page's trace file,
 *   relative to .next/server/app, and the files it lists
 * @returns {{ problems: string[], shipping: string[] }} the problems found, and
 *   the routes, and pages in RUNS_SHARP, that ship sharp's binding
 */
export function traceProblems(traces) {
  const problems = [];
  const shipping = [];
  for (const [trace, files] of traces) {
    if (!isRoute(trace) && !RUNS_SHARP.includes(trace)) continue;
    if (!files.some((file) => BINDING.test(file))) continue;
    shipping.push(trace);
    if (!files.some((file) => LIBVIPS.test(file))) {
      problems.push(`${trace}: ships sharp's native binding but not libvips (libvips-cpp.*)`);
    }
    if (SHARP_FREE.includes(trace)) {
      problems.push(`${trace}: ships sharp's native binding, but sign-in mustn't depend on sharp`);
    }
  }
  for (const trace of [...RUNS_SHARP, ...SHARP_FREE]) {
    if (!traces.has(trace)) problems.push(`${trace}: trace file missing`);
  }
  for (const trace of RUNS_SHARP) {
    if (traces.has(trace) && !shipping.includes(trace)) {
      problems.push(`${trace}: expected sharp's native binding in the trace, found none`);
    }
  }
  return { problems, shipping };
}

/** Every route's and page's trace under `dir`, keyed by its path relative to APP. */
function readTraces(dir, traces = new Map()) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) readTraces(path, traces);
    else if (name === 'route.js.nft.json' || name === 'page.js.nft.json') {
      traces.set(relative(APP, path), JSON.parse(readFileSync(path, 'utf8')).files ?? []);
    }
  }
  return traces;
}

function main() {
  if (!existsSync(APP)) {
    console.error(`check:trace: ${APP} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }
  const { problems, shipping } = traceProblems(readTraces(APP));
  if (problems.length) {
    console.error(`check:trace: sharp's native library is shipped wrong:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nSee outputFileTracingIncludes in next.config.js (WIS-156). Without libvips the ` +
        `route fails at runtime with ERR_DLOPEN_FAILED.`
    );
    process.exit(1);
  }
  const names = shipping.map((trace) => trace.replace(/\/(route|page)\.js\.nft\.json$/, ''));
  console.log(
    `check:trace: ok — ${shipping.length} routes ship sharp, each with libvips ` +
      `(${names.join(', ')}), and NextAuth's route ships none.`
  );
}

// Run as a script (`npm run check:trace`), not when a test imports it. Both
// paths resolved, so the check still runs when it's started through a symlink.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
