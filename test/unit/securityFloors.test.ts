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
  it('runs a Next.js with the 16.3.6 security fixes', () => {
    const { version } = require('next/package.json') as { version: string };
    expect(atLeast(version, '16.3.6'), `next ${version}`).toBe(true);
  });

  // regression: sharp 0.35.3 bundled libheif 1.23.1 (GHSA-rgj7-g3m4-5g8c, patched
  // in sharp 0.35.4 / libheif 1.23.2) and librsvg 2.62.90 (GHSA-wq5f-xc86-pv6w,
  // patched in sharp 0.35.5 / librsvg 2.63.2). POST /api/upload decodes
  // user-supplied bytes with it.
  it('runs a sharp whose bundled libheif and librsvg carry the fixes', () => {
    const { versions } = sharp;
    expect(atLeast(versions.sharp, '0.35.5'), `sharp ${versions.sharp}`).toBe(true);
    expect(atLeast(versions.heif, '1.23.2'), `libheif ${versions.heif}`).toBe(true);
    expect(atLeast(versions.rsvg, '2.63.2'), `librsvg ${versions.rsvg}`).toBe(true);
  });
});
