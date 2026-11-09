import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import sharp from 'sharp';

// Security floors that package.json relies on, checked against what's actually
// installed. A lockfile regeneration or a loosened range can't then quietly
// bring a patched advisory back. Exploit fixtures are off-limits, so this pins
// the patched versions instead of the behaviour.

const require = createRequire(import.meta.url);

/** Is dotted `version` at or above `floor`? Compares major.minor.patch numerically. */
function atLeast(version: string | undefined, floor: string): boolean {
  if (!version) return false;
  const parts = (v: string) => v.split(/[.+-]/).slice(0, 3).map(Number);
  const [have, need] = [parts(version), parts(floor)];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

describe('security floors of installed dependencies', () => {
  // regression: next 16.2.11 was inside GHSA-vcvr-r3jv-pc5j (next/og
  // ImageResponse, patched in 16.3.6) and GHSA-2xp9-vwfh-vxw4 / GHSA-p293-qw3h-jr36
  // (patched in 16.3.3).
  // regression: 16.3.8 also carried GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r
  // and GHSA-673q-mjm6-r5xr, patched in 16.4.1.
  it('runs a Next.js with the 16.4.1 security fixes', () => {
    const { version } = require('next/package.json') as { version: string };
    expect(atLeast(version, '16.4.1'), `next ${version}`).toBe(true);
  });

  // regression: sharp 0.35.3 bundled libheif 1.23.1 (GHSA-rgj7-g3m4-5g8c, patched
  // in sharp 0.35.4 / libheif 1.23.2) and librsvg 2.62.90 (GHSA-wq5f-xc86-pv6w,
  // patched in sharp 0.35.5 / librsvg 2.63.2). POST /api/upload decodes
  // user-supplied AVIFs with libheif. librsvg never sees an upload (WIS-157,
  // WIS-208): it only renders the share cards next/og draws from our own SVG,
  // but the process still loads it.
  it('runs a sharp whose bundled libheif and librsvg carry the fixes', () => {
    const { versions } = sharp;
    expect(atLeast(versions.sharp, '0.35.5'), `sharp ${versions.sharp}`).toBe(true);
    expect(atLeast(versions.heif, '1.23.2'), `libheif ${versions.heif}`).toBe(true);
    expect(atLeast(versions.rsvg, '2.63.2'), `librsvg ${versions.rsvg}`).toBe(true);
  });

  // regression: nodemailer 9.0.3 was inside GHSA-2x7j-588g-ccc2 (addressparser
  // DoS), GHSA-8m3c-c648-2xjj, GHSA-wmmp-3585-3rmp and GHSA-cc9r-2j5m-2m83, all
  // patched in 9.1.1, and 9.1.1 inside GHSA-v53p-9fqp-m79j and GHSA-prgh-xp8r-p3m5
  // (both addressparser DoS), GHSA-6vj9-mwq6-2f5v, GHSA-8vvx-rff5-p5rq and
  // GHSA-g57g-f23g-4646, all patched in 10.0.9. It sends the sign-in and invite
  // mail, and the sign-in form hands it whatever address the visitor typed.
  it('runs a nodemailer with the 10.0.9 security fixes', () => {
    const { version } = require('nodemailer/package.json') as { version: string };
    expect(atLeast(version, '10.0.9'), `nodemailer ${version}`).toBe(true);
  });

  // regression: the undici @vercel/blob ships with (6.28.0) was inside
  // GHSA-rfgv-xxqx-mfg5, GHSA-3wwx-pv8p-q78v and GHSA-r53p-7pc4-xj5r, patched in
  // 6.28.1, and the nanoid postcss ships with (3.3.16) inside GHSA-2v37-7h3g-55p8,
  // patched in 3.3.18. Both resolve to the hoisted copy checked here.
  it('runs the undici and nanoid with their security fixes', () => {
    const undici = (require('undici/package.json') as { version: string }).version;
    // regression: Blob's separate Undici 6 copy must also clear the November
    // TLS bypass / DoS advisories (including GHSA-2m5v-pch6-74hx).
    const blobRequire = createRequire(require.resolve('@vercel/blob'));
    const blobUndici = (blobRequire('undici/package.json') as { version: string }).version;
    expect(atLeast(blobUndici, '6.29.1'), `Blob undici ${blobUndici}`).toBe(true);
    const nanoid = (require('nanoid/package.json') as { version: string }).version;
    expect(atLeast(undici, '7.30.1'), `undici ${undici}`).toBe(true);
    expect(atLeast(nanoid, '3.3.18'), `nanoid ${nanoid}`).toBe(true);
  });
  // regression: GHSA-mrhx-c7xc-m3w5 affects both our schemas and Vercel's
  // CLI config dependency; checking only the hoisted Zod misses the latter.
  it('runs patched Zod in the app and Vercel CLI config', () => {
    const configReaders = ['@vercel/blob', '@vercel/functions'].map((pkg) => {
      const packageRequire = createRequire(require.resolve(pkg));
      const oidcRequire = createRequire(packageRequire.resolve('@vercel/oidc'));
      return createRequire(oidcRequire.resolve('@vercel/cli-config'));
    });
    for (const read of [require, ...configReaders]) {
      const { version } = read('zod/package.json') as { version: string };
      expect(atLeast(version, '4.6.6'), `zod ${version}`).toBe(true);
    }
  });
});
