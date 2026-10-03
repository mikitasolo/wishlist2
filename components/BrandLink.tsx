import Link from 'next/link';
import Logo from '@/components/Logo';

/**
 * The header's brand: the logo and "Wishlist", linking home. Below `sm` only
 * the logo shows (the link keeps its accessible name). Used by `AppHeader` and
 * by the error page, which can't risk the rest of the header.
 */
export default function BrandLink() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-2.5 transition-opacity hover:opacity-90"
      aria-label="Wishlist home"
    >
      <Logo className="h-8 w-8 rounded-[9px] shadow-[0_4px_12px_-3px_rgba(94,92,230,0.6)] transition-transform group-hover:scale-105" />
      <span className="hidden text-title font-semibold tracking-tight text-foreground sm:inline">
        Wishlist
      </span>
    </Link>
  );
}
