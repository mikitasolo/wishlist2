import { test, expect } from '@playwright/test';

// Share cards: each opengraph-image route renders a PNG through next/og's
// ImageResponse. They're requested signed out, the way a link-preview crawler
// fetches them, so a Next.js upgrade that breaks next/og rendering fails here
// rather than in production. This checks rendering only: the list and profile
// routes fall back to a generic card when their lookup fails, so a 200 PNG
// doesn't prove the seeded data was read.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const cards = [
  { name: 'the default card', path: '/opengraph-image' },
  { name: 'a public wishlist', path: '/wishlists/e2e-birthday/opengraph-image' },
  { name: 'a profile', path: '/users/e2euser/opengraph-image' },
];

for (const { name, path } of cards) {
  test(`the share card for ${name} renders as a 1200×630 PNG`, async ({ request }) => {
    const res = await request.get(path);

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^image\/png\b/);
    const body = await res.body();
    // A real PNG, not an error page served under the right header…
    expect(body.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // …rendered at the size the route declares (IHDR width/height).
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
  });
}
