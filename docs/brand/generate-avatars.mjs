// Renders the Telegram avatars to PNG. Telegram masks profile photos to a
// circle, so every design is full-bleed (corners are thrown away) with its
// subject inside the inscribed circle.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 512;
const OUT = process.argv[2] || './avatars';
mkdirSync(OUT, { recursive: true });

/** Brand violet, straight from app/icon.svg. */
const violet = `
  <linearGradient id="g" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}" gradientUnits="userSpaceOnUse">
    <stop stop-color="#8f8dff"/><stop offset="0.5" stop-color="#5e5ce6"/><stop offset="1" stop-color="#4644c0"/>
  </linearGradient>`;

/** Deeper violet→pink, using accent2 (#ff375f) to set the bot apart. */
const violetPink = `
  <linearGradient id="g" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}" gradientUnits="userSpaceOnUse">
    <stop stop-color="#7b6cff"/><stop offset="0.55" stop-color="#5e5ce6"/><stop offset="1" stop-color="#ff375f"/>
  </linearGradient>`;

/** Soft top-left sheen — the same mesh feel as the wishlist cover gradients. */
const sheen = `
  <radialGradient id="sheen" cx="0.28" cy="0.2" r="0.75">
    <stop stop-color="#ffffff" stop-opacity="0.34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>`;

function page(gradient, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>${gradient}${sheen}
    <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#1b1a4a" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#sheen)"/>
  ${body}
</svg>`;
}

// ---- Channel: the product mark, the gift box from app/icon.svg -------------
// Source art spans x 18.5–45.5, y 20.5–46 in a 64 box; centre it and scale up.
const GIFT = `
  <g filter="url(#drop)" transform="translate(256 262) scale(8.6) translate(-32 -33.25)">
    <rect x="18.5" y="27" width="27" height="19" rx="4.5" fill="#fff"/>
    <rect x="29.4" y="27" width="5.2" height="19" fill="#5e5ce6"/>
    <path d="M32 27 21.5 20.5 23.6 28.5Z" fill="#fff"/>
    <path d="M32 27 42.5 20.5 40.4 28.5Z" fill="#fff"/>
    <circle cx="32" cy="26.4" r="2.8" fill="#fff"/>
  </g>`;

// ---- Bot: a rocket, echoing the "🚀 released to production" message --------
const ROCKET = `
  <g filter="url(#drop)" transform="translate(256 264) scale(4.15) translate(-50 -50)">
    <path d="M40 74 Q50 104 60 74 Q50 84 40 74Z" fill="#ffc861"/>
    <path d="M31 45 14 64v13l17-15Z" fill="#c9c5ff"/>
    <path d="M69 45 86 64v13L69 62Z" fill="#c9c5ff"/>
    <path d="M50 6c12 14 19 33 19 51v7H31v-7c0-18 7-37 19-51Z" fill="#fff"/>
    <path d="M31 64h38l-6 12H37Z" fill="#e9e7ff"/>
    <circle cx="50" cy="35" r="10" fill="#5e5ce6"/>
    <circle cx="50" cy="35" r="4.4" fill="#8f8dff"/>
  </g>`;

const designs = [
  ['channel', page(violet, GIFT)],
  ['bot', page(violetPink, ROCKET)],
];

for (const [name, svg] of designs) {
  writeFileSync(`${OUT}/${name}.svg`, svg);
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/${name}.png`);
  // Circle-masked preview, to check it survives Telegram's crop.
  const mask = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#fff"/></svg>`
  );
  await sharp(Buffer.from(svg))
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(`${OUT}/${name}-circle.png`);
  console.log(`${name}.png + ${name}-circle.png`);
}
