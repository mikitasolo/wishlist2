'use client';

import Cover from '@/components/Cover';

/**
 * How wide the cover strip is drawn: the page's content width, which stops
 * growing at `max-w-7xl` less its `lg:px-8` gutters (76rem). For `BannerImage`,
 * so the browser fetches a fitting size.
 */
export const WISHLIST_COVER_SIZES = '(min-width: 1280px) 76rem, 100vw';

/**
 * A list's banner, as a short full-width strip above its title: 2.4:1 on a
 * phone, and from `sm` up 3:1 capped at 240px (`max-h-60`), so on a wide
 * screen it's a strip rather than a third of the page. Banners are stored at
 * the 16:9 they're cropped to (which list cards and share cards show as is),
 * so the strip trims their top and bottom (`object-cover`, centred).
 *
 * A list with no banner gets no strip at all, rather than a gradient block that
 * says nothing. A banner that fails to load (a freed blob, a dead external URL)
 * still shows the list's gradient in its place, as every `Cover` does.
 */
export default function WishlistCover({
  bannerUrl,
  seed,
}: {
  bannerUrl: string | null | undefined;
  /** The list's id: picks the gradient a banner that fails to load falls back to. */
  seed: string;
}) {
  if (!bannerUrl) return null;
  return (
    <Cover
      src={bannerUrl}
      seed={seed}
      priority
      sizes={WISHLIST_COVER_SIZES}
      className="relative mb-6 aspect-[12/5] w-full overflow-hidden rounded-2xl border border-border bg-surface-2 sm:aspect-[3/1] sm:max-h-60 sm:rounded-3xl"
    />
  );
}
