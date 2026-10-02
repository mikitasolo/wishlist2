#!/usr/bin/env node
// Run after `next build`. Fails if a route (an API route, a share card), or the
// sign-in page, ships sharp's native binding without the libvips shared library
// the binding links (WIS-156).
//
// Next's output file tracing follows `require`s, not the dynamic linker: it
// copies `@img/sharp-<platform>/lib/sharp-*.node` into a route's bundle but
// not `@img/sharp-libvips-<platform>/lib/libvips-cpp.*`, which that binding
// loads at runtime. On Vercel the route then crashes on its first
// `import('sharp')` with ERR_DLOPEN_FAILED. `outputFileTracingIncludes` in
// next.config.js ships the library; this check keeps it that way.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = '.next/server/app';
// Routes that must ship sharp, so the check can't pass by finding nothing:
// the upload route runs it, NextAuth's route reaches it through lib/email.ts,
// and a list's or profile's share card converts its banner or avatar with it
// (lib/og/photo.ts).
const REQUIRED = [
  'api/upload/route.js.nft.json',
  'api/auth/[...nextauth]/route.js.nft.json',
  'wishlists/[id]/opengraph-image/route.js.nft.json',
  'users/[username]/opengraph-image/route.js.nft.json',
];
// Pages that send email from a server action, and so render its logo with sharp
// in the page's own function: the sign-in form sends the magic link
// (app/auth/signin/actions.ts). Each must ship the binding and libvips.
const REQUIRED_PAGES = ['auth/signin/page.js.nft.json'];

const BINDING = /@img\/sharp-(?!wasm32)[^/]+\/lib\/sharp-[^/]+\.node$/;
const LIBVIPS = /@img\/sharp-libvips-[^/]+\/lib\/libvips-cpp\.[^/]+$/;

if (!existsSync(APP)) {
  console.error(`check:trace: ${APP} not found. Run \`npm run build\` first.`);
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
for (const path of traces(APP)) {
  const files = JSON.parse(readFileSync(path, 'utf8')).files ?? [];
  const route = relative(APP, path);
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
  if (!existsSync(join(APP, route))) problems.push(`${route}: trace file missing`);
}

for (const page of REQUIRED_PAGES) {
  const path = join(APP, page);
  if (!existsSync(path)) {
    problems.push(`${page}: trace file missing`);
    continue;
  }
  const files = JSON.parse(readFileSync(path, 'utf8')).files ?? [];
  if (!files.some((file) => BINDING.test(file))) {
    problems.push(`${page}: expected sharp's native binding in the trace, found none`);
  } else if (!files.some((file) => LIBVIPS.test(file))) {
    problems.push(`${page}: ships sharp's native binding but not libvips (libvips-cpp.*)`);
  }
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

const pages = REQUIRED_PAGES.map((page) => page.replace(/\/page\.js\.nft\.json$/, '')).join(', ');
console.log(
  `check:trace: ok — ${checked} routes and the email-sending pages (${pages}) ship sharp, ` +
    `each with libvips.`
);
