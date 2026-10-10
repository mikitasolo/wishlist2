'use client';

import { useState, type ReactNode } from 'react';
import BannerImage from '@/components/BannerImage';
import { coverGradient, coverInitial } from '@/lib/utils/cover';
import { coverBackground } from '@/lib/utils/coverPattern';

/** The initial a pattern cover wears as its monogram tag; pass a text-size class. */
export function CoverMonogram({ name, className = '' }: { name: string; className?: string }) {
  const initial = coverInitial(name);
  if (!initial) return null;
  return (
    <span
      className={`font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.3)] ${className}`}
    >
      {initial}
    </span>
  );
}

/**
 * The cover of a wishlist or item: a frame that shows its image, or the gradient
 * placeholder when there is none or it fails to load (a freed blob, a dead
 * external URL). The gradient is the frame's own background rather than a layer
 * inside it, so it still reaches under a bordered frame's border.
 *
 * Put this where the positioned, sized box goes: `className` must make it
 * `relative` and give it a size, because the image fills it. `children` are
 * overlays (badges, a shade, notes) and need their own positioning to paint on
 * top of the image.
 */
export default function Cover({
  src,
  seed,
  name,
  occasionKind,
  alt = '',
  sizes,
  priority,
  link,
  className,
  placeholder,
  children,
}: {
  src: string | null | undefined;
  /** Picks the placeholder gradient (e.g. the list's or item's id), so it never changes. */
  seed: string;
  /**
   * The list's or item's name: with it the placeholder gets a gift-wrap
   * pattern (WIS-397) whose variant it picks. Only what a viewer who can open
   * the list already sees.
   */
  name?: string;
  /** The list's occasion kind, which picks the pattern family; items pass none. */
  occasionKind?: string | null;
  alt?: string;
  /** How wide the frame is drawn, for the browser to pick the image's size (see `BannerImage`). */
  sizes: string;
  priority?: boolean;
  /**
   * Makes the frame a link to an external page, opened in a new tab (an item's
   * product page). Part of the cover rather than wrapped around it, so when a
   * card drops the link to show its notes, the cover stays mounted and still
   * knows its image is broken instead of trying it again.
   */
  link?: { href: string; label: string };
  className?: string;
  /**
   * Drawn over the gradient whenever it shows (no image, or one that failed to
   * load), under `children`: an item's initial. Decorative, so it's hidden
   * from assistive tech; the frame's `alt` or link label names the item.
   */
  placeholder?: ReactNode;
  children?: ReactNode;
}) {
  // Keyed on the URL, so an edit that replaces a broken image shows the new one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const gradient = coverGradient(seed);
  const style = {
    background: showImage
      ? undefined
      : name !== undefined
        ? coverBackground(gradient, occasionKind, name)
        : gradient,
  };
  const content = (
    <>
      {showImage && (
        <BannerImage
          src={src}
          alt={alt}
          sizes={sizes}
          priority={priority}
          onError={() => setFailedSrc(src)}
        />
      )}
      {!showImage && placeholder && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          {placeholder}
        </span>
      )}
      {children}
    </>
  );
  return link ? (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={link.label}
      className={className}
      style={style}
    >
      {content}
    </a>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}
