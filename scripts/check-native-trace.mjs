#!/usr/bin/env node
// Run after `next build`. Fails if an API route ships sharp's native binding
// without the libvips shared library the binding links (WIS-156).
//
// Next's output file tracing follows `require`s, not the dynamic linker: it
// copies `@img/sharp-<platform>/lib/sharp-*.node` into a route's bundle but
// not `@img/sharp-libvips-<platform>/lib/libvips-cpp.*`, which that binding
// loads at runtime. On Vercel the route then crashes on its first
// `import('sharp')` with ERR_DLOPEN_FAILED. `outputFileTracingIncludes` in
// next.config.js ships the library; this check keeps it that way.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_API = '.next/server/app/api';
// Routes that must ship sharp, so the check can't pass by finding nothing:
// the upload route runs it, and NextAuth's route reaches it through lib/email.ts.
const REQUIRED = ['upload/route.js.nft.json', 'auth/[...nextauth]/route.js.nft.json'];

const BINDING = /@img\/sharp-(?!wasm32)[^/]+\/lib\/sharp-[^/]+\.node$/;
const LIBVIPS = /@img\/sharp-libvips-[^/]+\/lib\/libvips-cpp\.[^/]+$/;

if (!existsSync(APP_API)) {
  console.error(`check:trace: ${APP_API} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function traces(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return traces(path);
    return name === 'route.js.nft.json' ? [path] : [];
  });
}

const problems = [];
let checked = 0;
for (const path of traces(APP_API)) {
  const files = JSON.parse(readFileSync(path, 'utf8')).files ?? [];
  const route = relative(APP_API, path);
  const hasBinding = files.some((file) => BINDING.test(file));
  const hasLibvips = files.some((file) => LIBVIPS.test(file));
  if (REQUIRED.includes(route) && !hasBinding) {
    problems.push(`${route}: expected sharp's native binding in the trace, found none`);
  }
  if (hasBinding && !hasLibvips) {
    problems.push(`${route}: ships sharp's native binding but not libvips (libvips-cpp.*)`);
  }
  if (hasBinding) checked++;
}

for (const route of REQUIRED) {
  if (!existsSync(join(APP_API, route))) problems.push(`${route}: trace file missing`);
}

if (problems.length) {
  console.error(`check:trace: sharp's native library is missing from route bundles:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nSee outputFileTracingIncludes in next.config.js (WIS-156). Without libvips the ` +
      `route fails at runtime with ERR_DLOPEN_FAILED.`
  );
  process.exit(1);
}

console.log(`check:trace: ok — ${checked} API routes ship sharp, each with libvips.`);
