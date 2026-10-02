#!/usr/bin/env node
// Read-only smoke check of a deployed host (WIS-156). GET requests only: it
// sends no sign-in email, uploads nothing and needs no credentials, so it's
// safe against staging or a preview. Production checks need the operator's go-ahead.
//
//   npm run smoke:deploy -- https://wishlist-staging.mikitasolo.co
//
// It checks that sign-in's routes and /api/upload start, and that a share card
// draws with sharp. /api/upload loads sharp, so on a bundle missing sharp's
// native libvips it answers 500. A share card still draws without sharp, but
// goes out as a PNG instead of a JPEG, so the card has to be a JPEG. The
// /api/auth/* routes and the sign-in page used to load sharp too, for the
// email logo (WIS-156); since WIS-208 they don't at all.
const base = process.argv[2]?.replace(/\/$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('usage: npm run smoke:deploy -- <https://host>');
  process.exit(2);
}

const checks = [
  {
    path: '/api/auth/csrf',
    expect: 200,
    body: (json) => typeof json?.csrfToken === 'string',
  },
  { path: '/api/auth/providers', expect: 200, body: (json) => Boolean(json?.nodemailer) },
  { path: '/api/auth/session', expect: 200 },
  // Only POST is exported, so a started route answers 405; a crashed one 500.
  { path: '/api/upload', expect: 405 },
  { path: '/auth/signin', expect: 200 },
  // A profile that doesn't exist gets the generic card, drawn on each request
  // by next/og (which rasterizes it from an SVG with sharp) and encoded as a
  // JPEG with sharp. Without sharp it would be a PNG.
  {
    path: '/users/smoke_deploy_no_such_user/opengraph-image',
    expect: 200,
    type: /^image\/jpeg$/,
  },
];

let failed = 0;
for (const check of checks) {
  const url = `${base}${check.path}`;
  let status = 'ERR';
  let ok = false;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
    status = res.status;
    ok = status === check.expect;
    if (ok && check.type) ok = check.type.test(res.headers.get('content-type') ?? '');
    if (ok && check.body) ok = check.body(await res.json().catch(() => null));
  } catch (error) {
    status = `ERR ${error.message}`;
  }
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} GET ${check.path} -> ${status} (want ${check.expect})`);
}

if (failed) {
  console.error(`\nsmoke:deploy: ${failed} check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`\nsmoke:deploy: all ${checks.length} checks passed against ${base}`);
