import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { EMAIL_LOGO_PNG_BASE64 } from '@/lib/emailLogo';

const SIZE = 96;
const ICON = readFileSync(join(process.cwd(), 'app/icon.svg'), 'utf8');
const LOGO_PNG = Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64');

// librsvg's anti-aliasing may differ a little from one platform or build to the
// next, so the logo is compared pixel by pixel, within a tolerance, not byte for
// byte. These are tight enough that each change to the drawing below is caught.
/** A channel this far off counts its pixel as different. */
const CHANNEL_TOLERANCE = 24;
/** At most this share of the pixels may differ (18 of 96×96)... */
const MAX_DIFFERENT_PIXELS = 0.002;
/** ...and the channels may be this far off on average. */
const MAX_MEAN_DIFFERENCE = 0.5;

/** An image's pixels, as RGBA. */
async function rgba(image: Sharp) {
  return image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** An SVG drawn at the logo's size, as the generator draws app/icon.svg. */
function rasterize(svg: string) {
  return rgba(sharp(Buffer.from(svg)).resize(SIZE, SIZE));
}

/** How far the PNG's pixels are from `other`'s (both RGBA, the same size). */
function difference(png: Buffer, other: Buffer) {
  let different = 0;
  let total = 0;
  for (let pixel = 0; pixel < png.length; pixel += 4) {
    let worst = 0;
    for (let channel = pixel; channel < pixel + 4; channel++) {
      const off = Math.abs(png[channel] - other[channel]);
      total += off;
      worst = Math.max(worst, off);
    }
    if (worst > CHANNEL_TOLERANCE) different++;
  }
  return { differentPixels: different / (png.length / 4), mean: total / png.length };
}

const drifted = ({ differentPixels, mean }: ReturnType<typeof difference>) =>
  differentPixels > MAX_DIFFERENT_PIXELS || mean > MAX_MEAN_DIFFERENCE;

describe('the email logo (lib/emailLogo.ts)', () => {
  let logo: Awaited<ReturnType<typeof rgba>>;

  // `sharp.block` is libvips state for the whole process (the upload route and
  // uploadImageFormat.test.ts set it), and Vitest may run other test files in
  // this one, so make sure the two loaders this reads with are open.
  beforeAll(async () => {
    sharp.unblock({ operation: ['VipsForeignLoadSvg', 'VipsForeignLoadPng'] });
    logo = await rgba(sharp(LOGO_PNG));
  });

  it('is a 96×96 PNG with transparency', async () => {
    expect(await sharp(LOGO_PNG).metadata()).toMatchObject({
      format: 'png',
      width: SIZE,
      height: SIZE,
      hasAlpha: true,
    });
  });

  // The PNG is generated from app/icon.svg and committed, so a change to the
  // logo leaves it behind until it's regenerated.
  it('still draws app/icon.svg (run `npm run generate:email-logo` if not)', async () => {
    const icon = await rasterize(ICON);
    expect(icon.info).toMatchObject({ width: SIZE, height: SIZE, channels: 4 });
    expect(logo.info).toMatchObject(icon.info);

    const off = difference(logo.data, icon.data);
    expect(drifted(off), JSON.stringify(off)).toBe(false);
  });

  // The tolerance must not hide a real change to the logo.
  it.each([
    ['the knot removed', ICON.replace(/<circle\b[^>]*\/>/, '')],
    ['the ribbon recoloured', ICON.replace('fill="#5e5ce6"/>', 'fill="#ff375f"/>')],
    ['a corner radius changed', ICON.replace('rx="17"', 'rx="12"')],
    ['a bow moved by a unit', ICON.replace('21.5 20.5', '20.5 19.5')],
    ['the gradient lightened', ICON.replace('#8f8dff', '#a09dff')],
  ])('notices a logo with %s', async (_change, svg) => {
    expect(svg).not.toBe(ICON);
    const changed = await rasterize(svg);

    expect(drifted(difference(logo.data, changed.data))).toBe(true);
  });
});
