import { test, expect } from './fixtures';

// Share cards: each opengraph-image route draws its card through next/og's
// ImageResponse; a list's and a profile's are then served as JPEGs (a PNG of a
// photo is megabytes). They're requested signed out, the way a link-preview
// crawler fetches them, so a Next.js upgrade that breaks next/og rendering (or
// a sharp that can't load) fails here rather than in production. This checks
// rendering only: the list and profile routes fall back to a generic card when
// their lookup fails, so a 200 doesn't prove the seeded data was read.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's width and height (IHDR), or null when it isn't one. */
function pngSize(body: Buffer): [number, number] | null {
  if (!body.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return [body.readUInt32BE(16), body.readUInt32BE(20)];
}

/** A JPEG's width and height (its start-of-frame segment), or null when it isn't one. */
function jpegSize(body: Buffer): [number, number] | null {
  if (body[0] !== 0xff || body[1] !== 0xd8) return null;
  for (let at = 2; at + 9 < body.length;) {
    if (body[at] !== 0xff) return null;
    const marker = body[at + 1];
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [body.readUInt16BE(at + 7), body.readUInt16BE(at + 5)];
    }
    at += 2 + body.readUInt16BE(at + 2);
  }
  return null;
}

const cards = [
  { name: 'the default card', path: '/opengraph-image', type: 'png', size: pngSize },
  {
    name: 'a public wishlist',
    path: '/wishlists/e2e-birthday/opengraph-image',
    type: 'jpeg',
    size: jpegSize,
  },
  { name: 'a profile', path: '/users/e2euser/opengraph-image', type: 'jpeg', size: jpegSize },
];

for (const { name, path, type, size } of cards) {
  test(`the share card for ${name} renders as a 1200×630 ${type.toUpperCase()}`, async ({
    request,
  }) => {
    const res = await request.get(path);

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(new RegExp(`^image/${type}\\b`));
    // A real image, not an error page served under the right header, rendered
    // at the size the route declares.
    expect(size(await res.body())).toEqual([1200, 630]);
  });
}

// A link-preview bot reads only the page's <head> and runs no JavaScript, so
// the shared list's or profile's own metadata has to be there, not streamed
// into <body> after it (next.config.js `htmlLimitedBots`). Telegram and Viber
// stand in for the bots Next's own list leaves out or only matches by accident.
const shares = [
  {
    name: 'a public wishlist',
    path: '/wishlists/e2e-birthday',
    title: 'E2E Birthday List',
    image: '/wishlists/e2e-birthday/opengraph-image',
    url: '/wishlists/e2e-birthday',
  },
  {
    name: 'a profile',
    path: '/users/e2euser',
    title: '@e2euser on Wishlist',
    image: '/users/e2euser/opengraph-image',
    url: '/users/e2euser',
  },
];
const previewBots = ['TelegramBot (like TwitterBot)', 'Viber/23.0'];

for (const { name, path, title, image, url } of shares) {
  for (const ua of previewBots) {
    test(`${ua.split(/[ /]/)[0]} finds the preview of ${name} in <head>`, async ({ request }) => {
      const res = await request.get(path, { headers: { 'user-agent': ua } });
      expect(res.status()).toBe(200);
      const head = (await res.text()).split('</head>')[0];
      const meta = (property: string) =>
        head.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];
      expect(meta('og:title')).toBe(title);
      expect(meta('og:url')).toMatch(new RegExp(`${url}$`));
      expect(meta('og:image')).toContain(image);
    });
  }
}
