import { describe, expect, it, vi } from 'vitest';
import { buildBookmarkletCode } from '@/scripts/build-bookmarklet.mjs';
import { BOOKMARKLET_CODE } from '@/lib/bookmarklet/code';
import { BOOKMARKLET_MAX_BYTES, bookmarkletHref } from '@/lib/bookmarklet/href';
import { APP_ORIGIN_PLACEHOLDER } from '@/lib/bookmarklet/placeholder';
import { bookmarkletTarget, runBookmarklet } from '@/lib/bookmarklet/run';
import { parseProductFragment } from '@/lib/utils/productFragment';

const PAGE = `<html><head><title>Lamp</title>
<meta property="og:title" content="Desk lamp"><meta property="og:image" content="https://shop.example/lamp.jpg">
<script type="application/ld+json">{"@type":"Product","name":"Desk lamp","offers":{"@type":"Offer","price":"24.50","priceCurrency":"EUR"}}</script>
</head><body></body></html>`;
const HREF = 'https://shop.example/p/lamp?utm=1&x=a b';

function fakeWindow(opts: { html?: string | (() => string); open?: () => unknown } = {}) {
  const win = {
    document: {
      documentElement: {
        get outerHTML() {
          const h = opts.html ?? PAGE;
          return typeof h === 'function' ? h() : h;
        },
      },
    },
    location: { href: HREF },
    open: vi.fn<(url: string, target: string) => unknown>(opts.open ?? (() => ({}))),
  };
  return win;
}

describe('bookmarklet target', () => {
  it('opens /items/new with a fragment /items/new can read back', () => {
    const url = bookmarkletTarget('https://app.test', PAGE, HREF);
    expect(url.startsWith('https://app.test/items/new#')).toBe(true);
    expect(parseProductFragment(new URL(url).hash)).toEqual({
      name: 'Desk lamp',
      imageUrl: 'https://shop.example/lamp.jpg',
      price: { value: 2450, currency: 'EUR' },
      link: HREF,
    });
  });

  it('carries only the link when the page has no product', () => {
    const url = bookmarkletTarget('https://app.test', '<html><body>hi</body></html>', HREF);
    expect(parseProductFragment(new URL(url).hash)?.link).toBe(HREF);
  });

  it('opens a new tab, and goes there in this one when the popup is blocked', () => {
    const ok = fakeWindow();
    runBookmarklet(ok, 'https://app.test');
    expect(ok.open).toHaveBeenCalledWith(
      expect.stringContaining('https://app.test/items/new#'),
      '_blank'
    );
    expect(ok.location.href).toBe(HREF);

    const blocked = fakeWindow({ open: () => null });
    runBookmarklet(blocked, 'https://app.test');
    expect(blocked.location.href).toMatch(/^https:\/\/app\.test\/items\/new#/);
  });

  // regression: an error while reading the page must still hand over the link, not do nothing.
  it('falls back to the link alone when reading the page throws', () => {
    const win = fakeWindow({
      html: () => {
        throw new Error('boom');
      },
    });
    runBookmarklet(win, 'https://app.test');
    expect(win.open).toHaveBeenCalledWith(
      `https://app.test/items/new#link=${encodeURIComponent(HREF)}`,
      '_blank'
    );
  });
});

describe('bookmarklet build', () => {
  it('matches the committed code (rerun npm run generate:bookmarklet)', async () => {
    expect(BOOKMARKLET_CODE).toBe(await buildBookmarkletCode());
  });

  it('is one self-contained snippet with a single origin placeholder, under the size budget', () => {
    expect(BOOKMARKLET_CODE.split(APP_ORIGIN_PLACEHOLDER)).toHaveLength(2);
    expect(BOOKMARKLET_CODE.length).toBeLessThan(BOOKMARKLET_MAX_BYTES);
    expect(BOOKMARKLET_CODE).not.toMatch(/\bimport\b|\brequire\(|fetch\(|XMLHttpRequest/);
  });

  it('makes a javascript: URL with the origin baked in', () => {
    const href = bookmarkletHref('http://localhost:3412');
    expect(href?.startsWith('javascript:')).toBe(true);
    const code = decodeURIComponent(href!.slice('javascript:'.length));
    expect(code).toContain('http://localhost:3412');
    expect(code).not.toContain(APP_ORIGIN_PLACEHOLDER);
    expect(href).not.toMatch(/\s/);
  });

  it('refuses an origin that is not plain http(s)', () => {
    for (const bad of ['', 'null', 'javascript:alert(1)', 'https://a.test/x', 'https://a.test"']) {
      expect(bookmarkletHref(bad)).toBeNull();
    }
  });

  it('runs end to end: the generated code opens the app on the page it was run on', () => {
    const win = fakeWindow();
    const code = decodeURIComponent(
      bookmarkletHref('https://app.test')!.slice('javascript:'.length)
    );
    new Function('window', `with (window) { ${code} }`)(win);
    expect(win.open).toHaveBeenCalledTimes(1);
    const url = new URL(win.open.mock.calls[0][0]);
    expect(url.origin).toBe('https://app.test');
    expect(parseProductFragment(url.hash)?.name).toBe('Desk lamp');
  });
});
