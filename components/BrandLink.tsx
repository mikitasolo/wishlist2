import Link from 'next/link';

/**
 * The header's brand: the "Wishlist" wordmark with an accent full stop, linking
 * home, at every width (no tile, glow or hover scale). Used by `AppHeader` and
 * by the error page, which can't risk the rest of the header.
 */
export default function BrandLink() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center whitespace-nowrap text-xl font-semibold tracking-tighter text-foreground transition-opacity hover:opacity-80"
      aria-label="Wishlist home"
    >
      Wishlist
      <span className="text-accent" aria-hidden="true">
        .
      </span>
    </Link>
  );
}
