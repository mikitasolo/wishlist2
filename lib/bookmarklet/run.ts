import { extractProduct } from '@/lib/utils/productExtract';
import { buildProductFragment } from '@/lib/utils/productFragment';

/**
 * What the bookmarklet does (WIS-367), as plain functions so a unit test can
 * drive them; `main.ts` is the thin entry `scripts/build-bookmarklet.mjs`
 * bundles around them. Everything imported here ends up in the frozen bookmark, so
 * keep these modules free of server-only or heavy imports (the size test is the backstop).
 */

function linkOnlyFragment(href: string): string {
  return `#link=${encodeURIComponent(href)}`;
}

/** `/items/new` on the app, carrying the product (or at least the page's link) in the fragment. */
export function bookmarkletTarget(origin: string, html: string, href: string): string {
  let fragment: string;
  try {
    fragment = buildProductFragment(extractProduct(html, href));
  } catch {
    fragment = linkOnlyFragment(href);
  }
  return `${origin}/items/new${fragment}`;
}

/** The slice of `window` the bookmarklet touches. */
export interface BookmarkletWindow {
  document: { documentElement: { outerHTML: string } };
  location: { href: string };
  open(url: string, target: string): unknown;
}

/**
 * Reads the rendered page, then opens the app on its product in a new tab
 * (the app can't be framed); with the popup blocked it goes there in this one.
 * Nothing is sent anywhere else and the page isn't modified. On any error the
 * user still gets the page's link.
 */
export function runBookmarklet(win: BookmarkletWindow, origin: string): void {
  let url: string;
  try {
    url = bookmarkletTarget(origin, win.document.documentElement.outerHTML, win.location.href);
  } catch {
    url = `${origin}/items/new${linkOnlyFragment(win.location.href)}`;
  }
  if (!win.open(url, '_blank')) win.location.href = url;
}
